const effectTypes = require('./effect-types')
const {UnexpectedTxMetaChangeError} = require('./errors')

function analyzeSignerChanges(before, after) {
    const beforeSigners = before ? before.signers : []
    const afterSigners = after ? after.signers : []
    const effects = []
    //determine the max length of the signers arrays
    const maxSize = Math.max(beforeSigners.length, afterSigners.length)
    for (let b = 0, a = 0; a < maxSize; b++, a++) {
        let bs = beforeSigners[b]
        const as = afterSigners[a]
        if (!bs) {//new signer added
            effects.push({
                type: effectTypes.accountSignerCreated,
                signer: as.key,
                weight: as.weight,
                masterWeight: after.masterWeight,
                signers: afterSigners
            })
            if (as.sponsor) {//signer sponsorship added
                effects.push({
                    type: effectTypes.signerSponsorshipCreated,
                    account: after.address,
                    signer: as.key,
                    sponsor: as.sponsor
                })
            }
            return effects
        }
        if (!as) { //last signer removed
            effects.push({
                type: effectTypes.accountSignerRemoved,
                signer: bs.key,
                weight: 0,
                masterWeight: after?.masterWeight || 0,
                signers: afterSigners
            })
            if (bs.sponsor) { //signer sponsorship removed
                effects.push({
                    type: effectTypes.signerSponsorshipRemoved,
                    account: before.address,
                    signer: bs.key,
                    prevSponsor: bs.sponsor
                })
            }
            return effects
        }
        //other signer removed
        if (as.key !== bs.key) {
            if (beforeSigners[a + 1]?.key !== as.key)
                throw new UnexpectedTxMetaChangeError({action: 'update', type: 'signer'})
            effects.push({
                type: effectTypes.accountSignerRemoved,
                signer: bs.key,
                weight: 0,
                masterWeight: after.masterWeight,
                signers: afterSigners
            })
        }
        //signer weight changed
        if (as.weight !== bs.weight) {
            effects.push({
                type: effectTypes.accountSignerUpdated,
                signer: as.key,
                weight: as.weight,
                masterWeight: after.masterWeight,
                signers: afterSigners
            })
        }
        //signer sponsor changed
        if (as.sponsor !== bs.sponsor) {
            if (!bs.sponsor && as.sponsor) {
                effects.push({
                    type: effectTypes.signerSponsorshipCreated,
                    account: after.address,
                    signer: as.key,
                    sponsor: as.sponsor
                })
            } else if (bs.sponsor && !as.sponsor) {
                effects.push({
                    type: effectTypes.signerSponsorshipRemoved,
                    account: after.address,
                    signer: bs.key,
                    prevSponsor: bs.sponsor
                })
            } else {
                effects.push({
                    type: effectTypes.signerSponsorshipUpdated,
                    account: after.address,
                    signer: as.key,
                    sponsor: as.sponsor,
                    prevSponsor: bs.sponsor
                })
            }
        }
        if (effects.length)
            break
    }
    return effects
}

module.exports = {analyzeSignerChanges}