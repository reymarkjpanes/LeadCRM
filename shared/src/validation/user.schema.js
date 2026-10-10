"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateUserSchema = exports.LoginSchema = exports.RegisterSchema = void 0;
const auth_schema_1 = require("./auth.schema");
var auth_schema_2 = require("./auth.schema");
Object.defineProperty(exports, "RegisterSchema", { enumerable: true, get: function () { return auth_schema_2.RegisterSchema; } });
const zod_1 = require("zod");
exports.LoginSchema = zod_1.z.object({
    email: zod_1.z.string().email('Invalid email address'),
    password: zod_1.z.string().min(1, 'Password is required'),
});
exports.CreateUserSchema = auth_schema_1.RegisterSchema.innerType()
    .omit({ acceptTerms: true })
    .extend({ role: zod_1.z.string().min(1, 'Role is required') });
