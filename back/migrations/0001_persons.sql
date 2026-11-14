CREATE TABLE persons (
id TEXT PRIMARY KEY,
nom TEXT NOT NULL, prenom TEXT NOT NULL, date_naissance TEXT NOT NULL,
sexe TEXT NOT NULL CHECK (sexe IN ('Femme','Homme','Autre','Non précisé')),
email TEXT NOT NULL, telephone TEXT NOT NULL, adresse TEXT NOT NULL,
photo_key TEXT, pdf_key TEXT,
created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX persons_name ON persons(nom COLLATE NOCASE, prenom COLLATE NOCASE);
CREATE TABLE uploads (key TEXT PRIMARY KEY, kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE file_gc (key TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
