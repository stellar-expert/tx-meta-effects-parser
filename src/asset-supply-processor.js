const effectTypes = require('./effect-types')

/**
 * Effect supply computation processor
 */
class AssetSupplyProcessor {
    constructor(effects) {
        this.assetTransfers = {}
        for (const effect of effects) {
            this.processEffect(effect)
        }
    }

    /**
     * @type {Object.<String,BigInt>}
     * @private
     */
    assetTransfers

    /**
     * @type {Boolean}
     * @private
     */
    processXlmBalances = false

    /**
     * Process generated operation effect
     * @param {{}} effect
     */
    processEffect(effect) {
        switch (effect.type) {
            case effectTypes.accountCredited:
            case effectTypes.contractCredited:
            case effectTypes.claimableBalanceCreated:
                //increase supply
                this.increase(effect.asset, effect.amount)
                break
            case effectTypes.accountDebited:
            case effectTypes.contractDebited:
            case effectTypes.claimableBalanceRemoved:
                //decrease supply
                this.decrease(effect.asset, effect.amount)
                break
            case effectTypes.liquidityPoolDeposited:
                //increase supply for every deposited asset (if liquidity provider is an issuer)
                for (const {asset, amount} of effect.assets) {
                    this.increase(asset, amount)
                }
                break
            case effectTypes.liquidityPoolWithdrew:
                //decrease supply for every deposited asset (if liquidity provider is an issuer)
                for (const {asset, amount} of effect.assets) {
                    this.decrease(asset, amount)
                }
                break
            case effectTypes.trade:
                if (effect.pool) {
                    for (let i = 0; i < effect.asset.length; i++) {
                        if (i === 0) { //increase supply if the issuer is seller
                            this.decrease(effect.asset[i], effect.amount[i])
                        } else {
                            this.increase(effect.asset[i], effect.amount[i])
                        }
                    }
                }
                break
            case effectTypes.contractInvoked:
                //start tracking XLM balance changes if there was at least one contract invocation
                this.processXlmBalances = true
                break
        }
    }

    /**
     * Calculate differences and generate minted/burned effects if needed
     * @return {{}[]}
     */
    resolve() {
        const res = []
        for (const [asset, sum] of Object.entries(this.assetTransfers)) {
            if (sum > 0n) {
                res.push({
                    type: effectTypes.assetMinted,
                    asset,
                    amount: sum.toString()
                })
            } else if (sum < 0n) {
                res.push({
                    type: effectTypes.assetBurned,
                    asset,
                    amount: (-sum).toString()
                })
            }
        }
        return res
    }

    /**
     * @param {String} asset
     * @param {String} amount
     * @private
     */
    increase(asset, amount) {
        if (!this.shouldProcessAsset(asset))
            return
        this.assetTransfers[asset] = (this.assetTransfers[asset] || 0n) + BigInt(amount)
    }

    /**
     * @param {String} asset
     * @param {String} amount
     * @private
     */
    decrease(asset, amount) {
        if (!this.shouldProcessAsset(asset))
            return
        this.assetTransfers[asset] = (this.assetTransfers[asset] || 0n) - BigInt(amount)
    }

    /**
     * @param {String} asset
     * @return {Boolean}
     */
    shouldProcessAsset(asset) {
        if (asset === 'XLM') //return true if we process XLM balance changes
            return this.processXlmBalances
        return asset.includes('-') || (asset.length === 56 && asset.startsWith('C')) //lazy checks for alphanum4/12 assets and contracts
    }
}

module.exports = AssetSupplyProcessor