const effectTypes = require('./effect-types')
const {isAsset} = require('./analyzer-primitives')
const BigNumber = require('bignumber.js')

class AssetSupplyProcessor {
    constructor(effects) {
        this.assetTransfers = {}
        for (const effect of effects) {
            this.processEffect(effect)
        }
    }

    assetTransfers

    add(asset, amount, negative = false) {
        const change = new BigNumber(negative ? '-' + amount : amount)
        this.assetTransfers[asset] = (this.assetTransfers[asset] || new BigNumber('0')).add(change)
    }

    processEffect(effect) {
        switch (effect.type) {
            case effectTypes.accountCredited:
                if (isAsset(effect.asset)) {
                    this.add(effect.asset, effect.amount, false)
                }
                break
            case effectTypes.accountDebited:
                if (isAsset(effect.asset)) {
                    this.add(effect.asset, effect.amount, true)
                }
                break
            case effectTypes.liquidityPoolDeposited:
                for (const {asset, amount} of effect.assets) {
                    if (isAsset(asset)) {
                        this.add(asset, amount, false)
                    }
                }
                break
            case effectTypes.liquidityPoolWithdrew:
                for (const {asset, amount} of effect.assets) {
                    if (isAsset(asset)) {
                        this.add(asset, amount, true)
                    }
                }
                break
            case effectTypes.claimableBalanceCreated:
                if (isAsset(effect.asset)) {
                    this.add(effect.asset, effect.amount, false)
                }
                break
            case effectTypes.claimableBalanceRemoved:
                if (isAsset(effect.asset)) {
                    this.add(effect.asset, effect.amount, true)
                }
                break
        }
    }

    resolve() {
        const res = []
        for (const [asset, sum] of Object.entries(this.assetTransfers))
            if (sum > 0) {
                res.push({
                    type: effectTypes.assetMinted,
                    asset,
                    amount: sum.toString()
                })
            } else if (sum < 0) {
                res.push({
                    type: effectTypes.assetBurned,
                    asset,
                    amount: sum.negated().toString()
                })
            }
        return res
    }
}

module.exports = AssetSupplyProcessor