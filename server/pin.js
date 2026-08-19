"use strict";

const LIMIT = 5;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map();

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "?";
}

function blocked(ip, now) {
  const rec = attempts.get(ip);
  return rec && rec.resetAt > now && rec.count >= LIMIT;
}

function record(ip, failed) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt < now) {
    attempts.set(ip, { count: failed ? 1 : 0, resetAt: now + WINDOW_MS });
  } else if (failed) {
    rec.count++;
  } else {
    attempts.delete(ip);
  }
}

function pinMatches(given) {
  const expected = process.env.EDIT_PIN;
  return !!(expected && given && given === expected);
}

function checkPin(req, res, next) {
  const ip = clientIp(req);
  if (blocked(ip, Date.now())) {
    return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi 10 menit lagi." });
  }
  if (!pinMatches(req.headers["x-edit-pin"])) {
    record(ip, true);
    return res.status(401).json({ error: "PIN edit salah." });
  }
  record(ip, false);
  next();
}

function verifyPin(req) {
  const ip = clientIp(req);
  if (blocked(ip, Date.now())) {
    return { ok: false, error: "Terlalu banyak percobaan. Coba lagi 10 menit lagi." };
  }
  const given = req.body && req.body.pin;
  if (!pinMatches(given)) {
    record(ip, true);
    return { ok: false, error: "PIN salah." };
  }
  record(ip, false);
  return { ok: true };
}

module.exports = { checkPin, verifyPin };