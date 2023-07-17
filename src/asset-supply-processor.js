const effectTypes = require('./effect-types')
const {isAsset, toStroops, fromStroops} = require('./analyzer-primitives')

class AssetSupplyProcessor {
    constructor(effects) {
        this.assetTransfers = {}
        for (const effect of effects) {
            this.processEffect(effect)
        }
    }

    assetTransfers

    add(asset, amount, negative = false) {
        let change = toStroops(amount)
        if (negative) {
            change *= -1n
        }
        this.assetTransfers[asset] = (this.assetTransfers[asset] || 0n) + change
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
            case effectTypes.trade:
                if (effect.pool) {
                    for (let i = 0; i < effect.asset.length; i++) {
                        const asset = effect.asset[i]
                        if (isAsset(asset)) {
                            this.add(asset, effect.amount[i], i === 0)
                        }
                    }
                }
                break
        }
    }

    resolve() {
        const res = []
        for (const [asset, sum] of Object.entries(this.assetTransfers))
            if (sum > 0n) {
                res.push({
                    type: effectTypes.assetMinted,
                    asset,
                    amount: fromStroops(sum)
                })
            } else if (sum < 0n) {
                res.push({
                    type: effectTypes.assetBurned,
                    asset,
                    amount: fromStroops(-sum)
                })
            }
        return res
    }
}

module.exports = AssetSupplyProcessor