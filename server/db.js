"use strict";

const { Pool } = require("pg");

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
    })
  : null;

async function q(text, params) {
  if (!pool) throw new Error("DATABASE_URL belum diatur.");
  return pool.query(text, params);
}

module.exports = { pool, q };