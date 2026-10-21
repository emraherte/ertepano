//! Protokol veri tipleri (docs/PROTOKOL.md §4).
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SignedItem {
    pub payload: String,
    pub sig: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Announcement {
    pub id: String,
    /// badge | toast | banner | fullscreen | survey | countdown
    pub kind: String,
    /// ik | isg | it | genel
    pub category: String,
    pub title: String,
    pub body: String,
    pub emoji: Option<String>,
    pub image_url: Option<String>,
    pub color: Option<String>,
    pub require_ack: bool,
    pub ack_label: Option<String>,
    pub options: Option<Vec<String>>,
    pub countdown_to: Option<String>,
    pub position: Option<String>,
    pub sound: bool,
    pub emergency_id: Option<String>,
    pub drill: bool,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Item {
    pub signed: SignedItem,
    pub a: Announcement,
}

pub fn parse_time(s: &Option<String>) -> Option<DateTime<Utc>> {
    s.as_deref()
        .filter(|s| !s.is_empty())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc))
}

impl Announcement {
    /// Şu an gösterilebilir mi (başlamış, bitmemiş, süresi dolmamış)?
    pub fn active(&self, now: DateTime<Utc>) -> bool {
        if parse_time(&self.starts_at).is_some_and(|t| t > now) {
            return false;
        }
        if parse_time(&self.ends_at).is_some_and(|t| t <= now) {
            return false;
        }
        if parse_time(&self.expires_at).is_some_and(|t| t <= now) {
            return false;
        }
        true
    }
}
