//! Bounded, account-isolated event caching. Only public calendar data is retained.
use crate::{events::Calendar, model::Account};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

#[derive(Default)]
pub struct EventCache {
    entries: HashMap<String, (Instant, Calendar)>,
}

pub fn cache_key(account: &Account, game: &str, server: &str) -> String {
    // Include credentials so replacing a connection cannot reuse the previous account's feed.
    let digest = Sha256::digest(format!("{}\0{}", account.hoyo_id, account.hoyo_token));
    format!("{}:{game}:{server}:{}", account.id, hex::encode(digest))
}

impl EventCache {
    pub fn get(&self, key: &str, now: Instant) -> Option<Calendar> {
        self.entries
            .get(key)
            .filter(|(at, _)| now.saturating_duration_since(*at) < Duration::from_secs(900))
            .map(|(_, calendar)| calendar.clone())
    }

    pub fn insert(&mut self, key: String, calendar: Calendar, now: Instant) {
        if !self.entries.contains_key(&key)
            && self.entries.len() >= 20
            && let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(key, _)| key.clone())
        {
            self.entries.remove(&oldest);
        }
        self.entries.insert(key, (now, calendar));
    }

    pub fn remove(&mut self, key: &str) {
        self.entries.remove(key);
    }
}
