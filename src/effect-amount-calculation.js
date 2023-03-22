const Bignumber = require('bignumber.js')
const effectTypes = require('./effect-types')
const {adjustPrecision, trimZeros} = require('./analyzer-primitives')

function calculateTradesSourceAmount(account, asset, changes, tradeEffects, defaultAmount = null) {
    if (!tradeEffects) //trades unavailable - return default amount
        return defaultAmount
    // summing up trades is the only way to calculate the amount
    const trades = tradeEffects.filter(e => e.type === effectTypes.trade)
    let res = new Bignumber(0)
    for (let i = 0; i < trades.length; i++) {
        const {amount, asset} = trades[i]
        if (i > 0 && trades[i - 1].asset.join() !== asset.join())
            break
        res = res.add(amount[1])
    }
    return trimZeros(res.toFixed(7))
}

function calculateTrustlineBalanceChange(changes, account, asset, action = 'updated') {
    const balanceUpdate = asset === 'XLM' ?
        changes.find(ch => ch.type === 'account' && ch.action === action && ch.before.address === account) :
        changes.find(ch => ch.type === 'trustline' && ch.action === action && ch.before.account === account && ch.before.asset === asset)
    if (!balanceUpdate)
        return '0'
    const beforeAmount = balanceUpdate.before.balance
    const afterAmount = balanceUpdate.after.balance
    if (beforeAmount === afterAmount)
        return '0'
    return adjustPrecision(new Bignumber(beforeAmount).minus(afterAmount).toString())
}

module.exports = {calculateTrustlineBalanceChange, calculateTradesSourceAmount}