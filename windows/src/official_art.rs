//! Extract public artwork configuration as data, never by executing website JavaScript.
use crate::{
    model::Event,
    provider::{Provider, Result},
};
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::HashMap;

const HOSTS: &[&str] = &[
    "hsr.hoyoverse.com",
    "act.hoyoverse.com",
    "act-webstatic.hoyoverse.com",
    "webstatic.hoyoverse.com",
    "endfield.gryphline.com",
    "web-static.hg-cdn.com",
];
pub fn official_url(value: &str, base: &str) -> Option<String> {
    let url = reqwest::Url::parse(value)
        .or_else(|_| reqwest::Url::parse(base)?.join(value))
        .ok()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && HOSTS.contains(&url.host_str()?)
        && url.port_or_known_default() == Some(443))
    .then(|| url.into())
}

pub fn read_literal(source: &str) -> Result<Value> {
    if source.len() > 8 * 1024 * 1024 {
        return Err("Artwork configuration exceeds limits.".into());
    }
    let mut parser = Parser {
        chars: source.chars().collect(),
        at: 0,
        nodes: 0,
    };
    parser.value(0)
}
struct Parser {
    chars: Vec<char>,
    at: usize,
    nodes: usize,
}
impl Parser {
    fn space(&mut self) {
        while self.chars.get(self.at).is_some_and(|c| c.is_whitespace()) {
            self.at += 1;
        }
    }
    fn take(&mut self) -> Result<char> {
        let c = *self.chars.get(self.at).ok_or("Incomplete artwork data.")?;
        self.at += 1;
        Ok(c)
    }
    fn string(&mut self, quote: char) -> Result<String> {
        let mut result = String::new();
        loop {
            let c = self.take()?;
            if c == quote {
                return Ok(result);
            }
            if c == '\n' || c == '\r' {
                return Err("Invalid artwork string.".into());
            }
            if c != '\\' {
                result.push(c);
                continue;
            }
            let escape = self.take()?;
            result.push(match escape {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                'b' => '\u{8}',
                'f' => '\u{c}',
                'v' => '\u{b}',
                '0' => '\0',
                'u' | 'x' => {
                    let count = if escape == 'u' { 4 } else { 2 };
                    let mut code = 0;
                    for _ in 0..count {
                        code = code * 16 + self.take()?.to_digit(16).ok_or("Invalid escape.")?;
                    }
                    // Combine JavaScript UTF-16 surrogate pairs into one Unicode character.
                    if (0xd800..=0xdbff).contains(&code) {
                        if self.take()? != '\\' || self.take()? != 'u' {
                            return Err("Invalid surrogate.".into());
                        }
                        let mut low = 0;
                        for _ in 0..4 {
                            low = low * 16 + self.take()?.to_digit(16).ok_or("Invalid escape.")?;
                        }
                        if !(0xdc00..=0xdfff).contains(&low) {
                            return Err("Invalid surrogate.".into());
                        }
                        code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
                    }
                    char::from_u32(code).ok_or("Invalid Unicode escape.")?
                }
                other => other,
            });
        }
    }
    fn value(&mut self, depth: usize) -> Result<Value> {
        self.nodes += 1;
        if depth > 100 || self.nodes > 150_000 {
            return Err("Artwork configuration exceeds limits.".into());
        }
        self.space();
        let c = self.take()?;
        if c == '\'' || c == '"' {
            return Ok(Value::String(self.string(c)?));
        }
        if c == '{' || c == '[' {
            let object = c == '{';
            let end = if object { '}' } else { ']' };
            let mut map = Map::new();
            let mut list = vec![];
            loop {
                self.space();
                if self.chars.get(self.at) == Some(&end) {
                    self.at += 1;
                    break;
                }
                if object {
                    let first = self.take()?;
                    let name = if first == '\'' || first == '"' {
                        self.string(first)?
                    } else {
                        if !first.is_ascii_alphanumeric() && !"_$-".contains(first) {
                            return Err("Invalid property.".into());
                        }
                        let mut name = first.to_string();
                        while let Some(c) = self
                            .chars
                            .get(self.at)
                            .copied()
                            .filter(|c| c.is_ascii_alphanumeric() || "_$-".contains(*c))
                        {
                            name.push(c);
                            self.at += 1;
                        }
                        name
                    };
                    self.space();
                    if self.take()? != ':' {
                        return Err("Invalid object.".into());
                    }
                    map.insert(name, self.value(depth + 1)?);
                } else {
                    list.push(self.value(depth + 1)?);
                }
                self.space();
                let sep = self.take()?;
                if sep == end {
                    break;
                }
                if sep != ',' {
                    return Err("Invalid list.".into());
                }
            }
            return Ok(if object {
                Value::Object(map)
            } else {
                Value::Array(list)
            });
        }
        let mut token = c.to_string();
        while let Some(c) = self
            .chars
            .get(self.at)
            .copied()
            .filter(|c| !c.is_whitespace() && !",]}".contains(*c))
        {
            token.push(c);
            self.at += 1;
        }
        match token.as_str() {
            "true" | "!0" => Ok(Value::Bool(true)),
            "false" | "!1" => Ok(Value::Bool(false)),
            "null" | "undefined" => Ok(Value::Null),
            _ => token
                .parse::<f64>()
                .ok()
                .and_then(serde_json::Number::from_f64)
                .map(Value::Number)
                .ok_or("Unsupported executable artwork configuration.".into()),
        }
    }
}
fn walk<'a>(
    value: &'a Value,
    parents: &mut Vec<&'a Value>,
    visit: &mut impl FnMut(&'a Value, &[&'a Value]),
) {
    if !value.is_object() && !value.is_array() {
        return;
    }
    visit(value, parents);
    parents.push(value);
    match value {
        Value::Object(map) => {
            for child in map.values() {
                walk(child, parents, visit);
            }
        }
        Value::Array(list) => {
            for child in list {
                walk(child, parents, visit);
            }
        }
        _ => {}
    }
    parents.pop();
}
fn string<'a>(value: &'a Value, pointer: &str) -> &'a str {
    value.pointer(pointer).and_then(Value::as_str).unwrap_or("")
}
fn translated<'a>(node: &'a Value, translations: &'a Value, field: &str) -> &'a str {
    let key = string(node, &format!("/otherOptions/mi18n/{field}/customKey"));
    translations
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| string(node, &format!("/options/{field}")))
}
fn dimension(value: &str) -> f64 {
    value.trim_end_matches("px").parse().unwrap_or(0.0)
}
pub fn hoyo_art(config: &Value, translations: &Value) -> Vec<(String, String)> {
    let mut result = vec![];
    walk(config, &mut vec![], &mut |node, parents| {
        if node["name"] != "@puzzle/text" {
            return;
        }
        let name = translated(node, translations, "text");
        if name.is_empty() || name.len() > 150 || name.contains(['<', '\n']) {
            return;
        }
        for parent in parents.iter().rev().take(5) {
            let mut best = None;
            let mut area = 0.0;
            walk(parent, &mut vec![], &mut |candidate, _| {
                if candidate["name"] != "@puzzle/image" {
                    return;
                }
                let width = dimension(string(candidate, "/boxStyle/width"));
                let height = dimension(string(candidate, "/boxStyle/height"));
                if width <= 0.0 || height <= 0.0 || !(1.3..=3.5).contains(&(width / height)) {
                    return;
                }
                if let Some(url) = official_url(translated(candidate, translations, "src"), "")
                    && width * height > area
                {
                    area = width * height;
                    best = Some(url);
                }
            });
            if let Some(image) = best {
                result.push((name.into(), image));
                break;
            }
        }
    });
    result
}
pub fn endfield_art(script: &str) -> Vec<(String, String)> {
    let base_re = Regex::new(r#"\.p="(https://web-static\.hg-cdn\.com/[^"\s]+/)""#).unwrap();
    let Some(base) = base_re.captures(script) else {
        return vec![];
    };
    let asset_re = Regex::new(r#""([^"\n]+)":\w+\.p\+"([^"\n]+)""#).unwrap();
    let assets: HashMap<_, _> = asset_re
        .captures_iter(script)
        .filter_map(|c| official_url(&c[2], &base[1]).map(|url| (c[1].to_string(), url)))
        .collect();
    let mut result = vec![];
    let pattern = Regex::new(r#"JSON\.parse\(\s*["']"#).unwrap();
    for hit in pattern.find_iter(script) {
        if let Ok(Value::String(json)) = read_literal(&script[hit.end() - 1..])
            && let Ok(data) = serde_json::from_str::<Value>(&json)
        {
            walk(&data, &mut vec![], &mut |node, _| {
                let name = string(node, "/name/en-us");
                if !name.is_empty()
                    && let Some(image) = assets.get(string(node, "/thumbnail/assetKey"))
                {
                    result.push((name.into(), image.clone()));
                }
            });
        }
    }
    result
}
fn normalized(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
pub fn apply(events: &mut [Event], artwork: &[(String, String)]) {
    for event in events.iter_mut().filter(|e| e.image.is_empty()) {
        let name = normalized(&event.name);
        if let Some((_, image)) = artwork
            .iter()
            .filter(|(candidate, _)| {
                let key = normalized(candidate);
                key.len() >= 8 && name.starts_with(&key)
            })
            .max_by_key(|(name, _)| normalized(name).len())
        {
            event.image = image.clone();
        }
    }
}
pub fn discover(provider: &Provider, game: &str, events: &mut [Event]) -> Result<()> {
    if !["hsr", "endfield"].contains(&game) || events.iter().all(|e| !e.image.is_empty()) {
        return Ok(());
    }
    let page = if game == "hsr" {
        "https://hsr.hoyoverse.com/en-us/"
    } else {
        "https://endfield.gryphline.com/version_briefing/latest"
    };
    let html = provider.public_art_text(page)?;
    let scripts = Regex::new(r#"<script[^>]+src=["']([^"']+)["']"#).unwrap();
    let script = scripts
        .captures_iter(&html)
        .filter_map(|c| official_url(&c[1], page))
        .find(|url| {
            if game == "hsr" {
                url.contains("/config.") && url.ends_with(".js")
            } else {
                url.contains("/version-") && url.ends_with(".js")
            }
        })
        .ok_or("Official page format changed.")?;
    let source = provider.public_art_text(&script)?;
    let art = if game == "endfield" {
        endfield_art(&source)
    } else {
        let start = source
            .find("={baseInfo:")
            .ok_or("Official page format changed.")?
            + 1;
        let config = read_literal(&source[start..])?;
        let id = string(&config, "/baseInfo/mi18n/key");
        if !id.starts_with('m') || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err("Official translation key unavailable.".into());
        }
        let translations: Value = serde_json::from_str(&provider.public_art_text(&format!(
            "https://webstatic.hoyoverse.com/admin/mi18n/hkrpg_global/{id}/{id}-en-us.json"
        ))?)
        .map_err(|_| "Invalid translations.")?;
        hoyo_art(&config, &translations)
    };
    apply(events, &art);
    Ok(())
}
