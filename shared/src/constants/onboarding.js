"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONBOARDING_STEP = void 0;
exports.getOnboardingState = getOnboardingState;
exports.isOnboardingComplete = isOnboardingComplete;
exports.ONBOARDING_STEP = {
    INTRODUCTION: 0,
    WORKFLOW: 1,
    COMPANY: 2,
    COMPLETED: 3,
};
function getOnboardingState(state) {
    const { onboardingStep: step, onboardingCompletedAt: completedAt } = state;
    if (completedAt)
        return 'completed';
    switch (step) {
        case exports.ONBOARDING_STEP.INTRODUCTION: return 'introduction';
        case exports.ONBOARDING_STEP.WORKFLOW: return 'workflow';
        case exports.ONBOARDING_STEP.COMPANY: return 'company';
        default: return 'invalid';
    }
}
function isOnboardingComplete(state) {
    return getOnboardingState(state) === 'completed';
}
