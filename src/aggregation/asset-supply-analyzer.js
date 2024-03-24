const effectTypes = require('../effect-types')

/**
 * Effect supply computation processor
 */
class AssetSupplyAnalyzer {
    /**
     * @param {EffectsAnalyzer} effectsAnalyzer
     */
    constructor(effectsAnalyzer) {
        this.assetTransfers = new Map()
        this.processXlmBalances = effectsAnalyzer.isContractCall
        this.effectsAnalyzer = effectsAnalyzer
    }

    /**
     * @type {EffectsAnalyzer}
     * @private
     */
    effectsAnalyzer
    /**
     * @type {Map<String,BigInt>}
     * @private
     */
    assetTransfers
    /**
     * @type {Boolean}
     * @private
     */
    processXlmBalances = false
    /**
     * @type {Number}
     * @private
     */
    supplyChanges = 0

    /**
     * Calculate differences and generate minted/burned effects if needed
     */
    analyze() {
        for (const effect of this.effectsAnalyzer.effects) {
            this.processEffect(effect)
        }
        for (const [asset, amount] of this.assetTransfers.entries()) {
            if (amount > 0n) {
                this.effectsAnalyzer.mint(asset, amount.toString(), true)
                this.supplyChanges |= 2
            } else if (amount < 0n) {
                this.effectsAnalyzer.burn(asset, (-amount).toString())
                this.supplyChanges |= 1
            }
        }
        if ((this.supplyChanges & 3) === 3) { //analyze possible collapsible mints only if both mint and burn effects recorded
            new CollapsibleMintsAnalyzer(this.effectsAnalyzer).removeCollapsingMints()
        }
    }

    /**
     * Process generated operation effect
     * @param {{}} effect
     */
    processEffect(effect) {
        switch (effect.type) {
            case effectTypes.accountCredited:
            case effectTypes.claimableBalanceCreated:
                //increase supply
                this.increase(effect.asset, effect.amount)
                break
            case effectTypes.assetBurned:
                //increase supply
                this.increase(effect.asset, effect.amount)
                this.supplyChanges |= 1
                break
            case effectTypes.accountDebited:
            case effectTypes.claimableBalanceRemoved:
                //decrease supply
                this.decrease(effect.asset, effect.amount)
                break
            case effectTypes.assetMinted:
                //decrease supply
                this.decrease(effect.asset, effect.amount)
                this.supplyChanges |= 2
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
        }
    }

    /**
     * @param {String} asset
     * @param {String} amount
     * @private
     */
    increase(asset, amount) {
        if (!this.shouldProcessAsset(asset))
            return
        this.assetTransfers.set(asset, (this.assetTransfers.get(asset) || 0n) + BigInt(amount))
    }

    /**
     * @param {String} asset
     * @param {String} amount
     * @private
     */
    decrease(asset, amount) {
        if (!this.shouldProcessAsset(asset))
            return
        this.assetTransfers.set(asset, (this.assetTransfers.get(asset) || 0n) - BigInt(amount))
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

class CollapsibleMintsAnalyzer {
    /**
     * @param {EffectsAnalyzer} effectsAnalyzer
     */
    constructor(effectsAnalyzer) {
        this.effectsAnalyzer = effectsAnalyzer
        this.supply = new Map()
    }

    /**
     * @type {EffectsAnalyzer}
     * @private
     */
    effectsAnalyzer
    /**
     * @type {Map<String,[]>}
     * @private
     */
    supply

    removeCollapsingMints() {
        const {effects} = this.effectsAnalyzer
        for (const effect of effects) {
            if (effect.type === effectTypes.assetMinted || effect.type === effectTypes.assetBurned) {
                this.addEffectToSupplyCounter(effect)
            }
        }
        for (const [asset, assetEffects] of this.supply.entries()) {
            if (assetEffects.length < 2)
                continue //skip non-collapsible effects
            //aggregate amount
            let sum = 0n
            let position
            for (const effect of assetEffects) {
                sum += effect.type === effectTypes.assetMinted ? BigInt(effect.amount) : -BigInt(effect.amount) //add to the running total
                position = effects.indexOf(effect) //find effect position in the parent effects container
                effects.splice(position, 1) //remove the effect from the parent container
            }
            if (sum > 0n) { //asset minted
                this.effectsAnalyzer.mint(asset, sum.toString(), true) //insert mint effect
            } else if (sum < 0n) { //asset burned
                this.effectsAnalyzer.burn(asset, sum.toString(), position) //insert burn effect at the position of the last removed effect
            }
            //if sum=0 then both effects were annihilated and removed
        }
    }

    /**
     * @param {{}} effect
     * @private
     */
    addEffectToSupplyCounter(effect) {
        let container = this.supply.get(effect.asset)
        if (!container) {
            container = []
            this.supply.set(effect.asset, container)
        }
        container.push(effect)
    }
}

module.exports = AssetSupplyAnalyzer