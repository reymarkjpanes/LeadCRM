"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SALES_PIPELINE_STAGES = exports.StageColorSchema = void 0;
exports.pipelineStageColor = pipelineStageColor;
const zod_1 = require("zod");
exports.StageColorSchema = zod_1.z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a six-digit hexadecimal color, such as #64748B.');
exports.SALES_PIPELINE_STAGES = ['Lead', 'Contacted', 'Qualified', 'Closed Won', 'Closed Lost'];
/** Saved colors always take precedence. Defaults apply only to unconfigured stages. */
function pipelineStageColor(stage) {
    if (stage.color)
        return stage.color;
    const defaults = { lead: '#64748B', contacted: '#3B82F6', qualified: '#8B5CF6', 'closed won': '#10B981', 'closed lost': '#EF4444' };
    return defaults[stage.name.trim().toLowerCase()] ?? '#64748B';
}
