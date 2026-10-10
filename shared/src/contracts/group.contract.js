"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateGroupSchema = exports.CreateGroupSchema = exports.GroupNameSchema = void 0;
const zod_1 = require("zod");
exports.GroupNameSchema = zod_1.z.string().trim().min(1, 'Name is required.').max(100, 'Name must be 100 characters or fewer.');
exports.CreateGroupSchema = zod_1.z.object({ name: exports.GroupNameSchema });
exports.UpdateGroupSchema = exports.CreateGroupSchema;
