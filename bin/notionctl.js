#!/usr/bin/env node
import('../dist/src/index.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
