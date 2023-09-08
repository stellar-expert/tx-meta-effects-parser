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
     * @type {Object.<String,{amount:BigInt, [anchoredAsset]:String}>}
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
            case effectTypes.assetBurned:
                //increase supply
                this.increase(effect.asset, effect.amount, effect.anchoredAsset)
                break
            case effectTypes.accountDebited:
            case effectTypes.contractDebited:
            case effectTypes.claimableBalanceRemoved:
            case effectTypes.assetMinted:
                //decrease supply
                this.decrease(effect.asset, effect.amount, effect.anchoredAsset)
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
        for (const [asset, value] of Object.entries(this.assetTransfers)) {
            if (value.amount === 0n)
                continue
            const effect = {
                type: effectTypes.assetMinted,
                asset
            }
            if (value.anchoredAsset) {
                effect.anchoredAsset = value.anchoredAsset
            }
            if (value.amount > 0n) {
                effect.type = effectTypes.assetMinted
                effect.amount = value.amount.toString()
            }
            if (value.amount < 0n) {
                effect.type = effectTypes.assetBurned
                effect.amount = (-value.amount).toString()
            }
            res.push(effect)
        }
        return res
    }

    /**
     * @param {String} asset
     * @param {String} amount
     * @param {String} anchoredAsset
     * @private
     */
    increase(asset, amount, anchoredAsset = undefined) {
        if (!this.shouldProcessAsset(asset))
            return
        const value = {
            amount: (this.assetTransfers[asset]?.amount || 0n) + BigInt(amount)
        }
        if (anchoredAsset !== undefined) {
            value.anchoredAsset = anchoredAsset
        }
        this.assetTransfers[asset] = value
    }

    /**
     * @param {String} asset
     * @param {String} amount
     * @param {String} anchoredAsset
     * @private
     */
    decrease(asset, amount, anchoredAsset = undefined) {
        if (!this.shouldProcessAsset(asset))
            return
        const value = {
            amount: (this.assetTransfers[asset]?.amount || 0n) - BigInt(amount)
        }
        if (anchoredAsset !== undefined) {
            value.anchoredAsset = anchoredAsset
        }
        this.assetTransfers[asset] = value
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