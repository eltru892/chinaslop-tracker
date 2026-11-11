use crate::model::{Settings, Snapshot, game_name, period, server_name};
use crate::provider::Result;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
use base64::{Engine, engine::general_purpose::STANDARD};
use rand::RngCore;
use rusqlite::{Connection, params};
use std::io::Write;
use std::path::{Path, PathBuf};
pub struct Vault {
    pub root: PathBuf,
}
impl Vault {
    pub fn new() -> Result<Self> {
        let dirs = directories::ProjectDirs::from("com", "ChinaslopTracker", "Rust")
            .ok_or("Could not locate local application storage.")?;
        std::fs::create_dir_all(dirs.data_local_dir())
            .map_err(|_| "Could not create app storage.")?;
        Ok(Self {
            root: dirs.data_local_dir().into(),
        })
    }
    pub fn load(&self) -> Result<Settings> {
        let path = self.root.join("settings.enc");
        if !path.exists() {
            return Ok(Settings::default());
        }
        let bytes = std::fs::read(path).map_err(|_| "Could not read encrypted settings.")?;
        let key = master_key(false)?;
        let clear = decrypt(&key, &bytes)?;
        serde_json::from_slice(&clear)
            .map_err(|_| "Saved settings are unreadable. Original file retained.".into())
    }
    pub fn save(&self, settings: &Settings) -> Result<()> {
        let key = master_key(!self.root.join("settings.enc").exists())?;
        let clear = serde_json::to_vec(settings).map_err(|_| "Could not serialize settings.")?;
        let encrypted = encrypt(&key, &clear)?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root)
            .map_err(|_| "Could not create temporary settings file.")?;
        temporary
            .write_all(&encrypted)
            .map_err(|_| "Could not write settings.")?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| "Could not flush settings.")?;
        temporary
            .persist(self.root.join("settings.enc"))
            .map_err(|_| "Could not replace settings. Previous file retained.")?;
        Ok(())
    }
}
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn master_key(create: bool) -> Result<[u8; 32]> {
    let entry = keyring::Entry::new("ChinaslopTracker.Rust", "settings-key")
        .map_err(|_| "The OS credential store is unavailable.")?;
    let encoded = match entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) if create => {
            let mut key = [0u8; 32];
            rand::rng().fill_bytes(&mut key);
            let encoded = STANDARD.encode(key);
            entry
                .set_password(&encoded)
                .map_err(|_| "Could not save the encryption key in the OS credential store.")?;
            // Verify persistence before encrypting settings with this new key.
            let saved = entry
                .get_password()
                .map_err(|_| "Could not verify the saved encryption key.")?;
            if saved != encoded {
                return Err("The credential store did not retain the encryption key.".into());
            }
            encoded
        }
        Err(_) => {
            return Err(
                "Could not unlock settings through the OS credential store. Existing data was not changed."
                    .into(),
            );
        }
    };
    STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid stored encryption key.")?
        .try_into()
        .map_err(|_| "Invalid encryption key length.".into())
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn master_key(_: bool) -> Result<[u8; 32]> {
    Err("Credential storage currently supports Windows and macOS.".into())
}
pub fn encrypt(key: &[u8; 32], clear: &[u8]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid key.")?;
    let mut nonce = [0u8; 12];
    rand::rng().fill_bytes(&mut nonce);
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), clear)
        .map_err(|_| "Encryption failed.")?;
    let mut output = vec![1];
    output.extend_from_slice(&nonce);
    output.extend(encrypted);
    Ok(output)
}
pub fn decrypt(key: &[u8; 32], encrypted: &[u8]) -> Result<Vec<u8>> {
    if encrypted.len() < 29 || encrypted[0] != 1 {
        return Err("Invalid encrypted settings format.".into());
    }
    Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Invalid key.")?
        .decrypt(Nonce::from_slice(&encrypted[1..13]), &encrypted[13..])
        .map_err(|_| "Settings could not be decrypted. Original file retained.".into())
}
pub struct History {
    connection: Connection,
}
impl History {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path).map_err(|_| "Could not open history database.")?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "Could not configure history.")?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,label TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS history(account TEXT NOT NULL,kind TEXT NOT NULL,period TEXT NOT NULL,observed TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(account,kind,period));
            CREATE INDEX IF NOT EXISTS history_period ON history(kind,period DESC);",
            )
            .map_err(|_| "Could not initialize history database.")?;
        Ok(Self { connection })
    }
    pub fn save(&mut self, snapshots: &[Snapshot]) -> Result<()> {
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| "Could not start history update.")?;
        for s in snapshots
            .iter()
            .filter(|s| s.error.is_empty() && !s.uid.is_empty())
        {
            transaction
                .execute(
                    "INSERT INTO accounts VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET label=excluded.label",
                    params![
                        s.identity(), format!("{} · {} · {} Server · {}", s.nickname,
                        game_name(& s.game), server_name(& s.region), s.uid)
                    ],
                )
                .map_err(|_| "Could not save history account.")?;
            for weekly in [false, true] {
                transaction
                    .execute(
                        "INSERT INTO history VALUES(?1,?2,?3,?4,?5) ON CONFLICT(account,kind,period) DO UPDATE SET observed=excluded.observed,payload=excluded.payload WHERE excluded.observed >= history.observed",
                        params![
                            s.identity(), if weekly { "weekly" } else { "daily" },
                            period(s, weekly), s.observed_at
                            .to_rfc3339_opts(chrono::SecondsFormat::Nanos, true),
                            serde_json::to_string(s).map_err(| _ |
                            "Invalid history snapshot.") ?
                        ],
                    )
                    .map_err(|_| "Could not save progress history.")?;
            }
        }
        transaction
            .commit()
            .map_err(|_| "Could not commit history.".into())
    }
    pub fn accounts(&self) -> Result<Vec<(String, String)>> {
        let mut statement = self
            .connection
            .prepare("SELECT id,label FROM accounts ORDER BY label")
            .map_err(|_| "History query failed.")?;
        statement
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|_| "History query failed.")?
            .collect::<std::result::Result<_, _>>()
            .map_err(|_| "History account read failed.".into())
    }
    pub fn read(
        &self,
        account: &str,
        weekly: bool,
        page: usize,
        size: usize,
    ) -> Result<(Vec<(String, Snapshot)>, usize)> {
        let kind = if weekly { "weekly" } else { "daily" };
        let size = size.clamp(1, 100);
        let total: usize = self
            .connection
            .query_row(
                "SELECT COUNT(*) FROM history WHERE kind=?1 AND (?2='' OR account=?2)",
                params![kind, account],
                |r| r.get(0),
            )
            .map_err(|_| "History count failed.")?;
        let mut statement = self
            .connection
            .prepare(
                "SELECT period,payload FROM history WHERE kind=?1 AND (?2='' OR account=?2) ORDER BY period DESC,account LIMIT ?3 OFFSET ?4",
            )
            .map_err(|_| "History query failed.")?;
        let rows = statement
            .query_map(
                params![kind, account, size, page.saturating_mul(size)],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .map_err(|_| "History query failed.")?;
        let mut result = vec![];
        for row in rows {
            let (period, payload) = row.map_err(|_| "History read failed.")?;
            let snapshot =
                serde_json::from_str(&payload).map_err(|_| "A history record is unreadable.")?;
            result.push((period, snapshot));
        }
        Ok((result, total))
    }
}
