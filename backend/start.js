/**
 * Production entry point for Render deployment.
 * This file is copied into dist/ during build.
 * Render start command: node dist/start.js
 *
 * Responsibilities:
 * 1. Register module alias for @leadcrm/shared → compiled shared package
 * 2. Boot the Express server
 */
'use strict';

const Module = require('module');
const path = require('path');

// --- Module alias: @leadcrm/shared → dist/shared/src/index.js ---
// TypeScript path aliases compile to bare `require('@leadcrm/shared')` in JS.
// In production (Render), npm workspaces aren't linked from the backend dist dir,
// so we intercept the require and resolve to the compiled shared package.
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === '@leadcrm/shared') {
    return path.join(__dirname, 'shared', 'src', 'index.js');
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// --- Boot server ---
require(process.argv.includes('--notifications-worker')
  ? './backend/src/modules/notifications/notification-worker.js'
  : './backend/src/server.js');
