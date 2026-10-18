"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatMoney = formatMoney;
function formatMoney(value, symbol = '₱', fractionDigits = 0) {
    return `${symbol}${Number(value).toLocaleString('en-PH', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}`;
}
