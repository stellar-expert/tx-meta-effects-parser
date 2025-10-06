const TtlCache = require('../cache/ttl-cache')
const {contractIdFromAsset} = require('../parser/contract-preimage-encoder')
const {toStellarAsset} = require('../parser/normalization')

const sacCache = new TtlCache()

/**
 * Check and map SAC contract addresses with Classic assets
 * @param {EffectsAnalyzer} effectsAnalyzer
 * @param {String} contractAddress
 * @param {String} classicAsset
 * @return {Boolean}
 */
function mapSacContract(effectsAnalyzer, contractAddress, classicAsset) {
    if (!classicAsset)
        return false
    const {network, sacMap} = effectsAnalyzer
    if (!sacMap)
        return false
    const prevMapping = sacMap.get(contractAddress)
    if (prevMapping) {
        return prevMapping === classicAsset
    }
    //try to load from cache first
    const fromCache = sacCache.get(classicAsset + network)
    if (!fromCache) {
        try {
            const encodedContract = contractIdFromAsset(toStellarAsset(classicAsset), network)
            sacCache.set(classicAsset + network, contractAddress)
            if (contractAddress === undefined) {
                contractAddress = encodedContract
            } else if (encodedContract !== contractAddress)
                return false
        } catch (e) {
            return false
        }
    } else if (contractAddress !== fromCache)
        return false //check whether validated contract from cache matches the asset
    if (sacMap) {
        sacMap.set(contractAddress, classicAsset)
    }
    return true
}

/**
 * Dispose SAC cache mapping and release cleanup timers
 */
function disposeSacCache() {
    sacCache.dispose()
}

module.exports = {mapSacContract, disposeSacCache}