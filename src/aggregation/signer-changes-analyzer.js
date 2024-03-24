const effectTypes = require('../effect-types')

class SignerChangesAnalyzer {
    constructor(before, after) {
        this.before = before
        this.after = after
        this.signers = after ? [...after.signers] : []
    }

    after

    before

    signers

    effects

    analyze() {
        //search for changes
        this.effects = []
        this.analyzeMasterWeight()

        const beforeSigners = this.before ? this.before.signers : []
        const afterSigners = this.after ? this.after.signers : []
        //skip if there is nothing to analyze
        if (!beforeSigners.length && !afterSigners.length)
            return this.effects

        const processed = new Set()
        //compare existing signers
        for (const bs of beforeSigners) {
            //mark signer key as processed
            processed.add(bs.key)
            //locate corresponding post-change signer
            const as = afterSigners.find(signer => signer.key === bs.key)
            if (!as) { //not found -- singer has been removed
                if (bs.sponsor) {
                    this.removeSignerSponsorship(bs)
                }
                this.removeAccountSigner(bs)
                continue
            }

            //check for weight changes
            if (as.weight !== bs.weight) {
                this.updateAccountSigner(as)
            }
            //signer sponsor changed
            if (as.sponsor !== bs.sponsor) {
                if (!bs.sponsor && as.sponsor) {
                    this.createSignerSponsorship(as)
                } else if (bs.sponsor && !as.sponsor) {
                    this.removeSignerSponsorship(bs)
                } else {
                    this.updateSignerSponsorship(as, bs.sponsor)
                }
            }
        }
        //check for new signers
        for (const as of afterSigners) {
            if (!processed.has(as.key)) {
                this.createAccountSigner(as)
                if (as.sponsor) {
                    this.createSignerSponsorship(as)
                }
            }
        }
        return this.effects
    }

    analyzeMasterWeight() {
        const {before, after} = this
        if (!before || !after || before.masterWeight === after.masterWeight)
            return
        const signer = {key: after.address, weight: after.masterWeight}
        if (after.masterWeight > 0) {
            this.updateAccountSigner(signer)
        } else {
            this.removeAccountSigner(signer)
        }
        if (after.masterWeight !== 1) {
            this.signers.push(signer)
        }
    }

    createAccountSigner(signer) {
        this.effects.push({
            type: effectTypes.accountSignerCreated,
            signer: signer.key,
            weight: signer.weight,
            signers: this.signers
        })
    }

    removeAccountSigner(signer) {
        this.effects.push({
            type: effectTypes.accountSignerRemoved,
            signer: signer.key,
            weight: 0,
            signers: this.signers
        })
    }

    updateAccountSigner(signer) {
        this.effects.push({
            type: effectTypes.accountSignerUpdated,
            signer: signer.key,
            weight: signer.weight,
            signers: this.signers
        })
    }

    createSignerSponsorship(signer) {
        this.effects.push({
            type: effectTypes.signerSponsorshipCreated,
            account: this.after.address,
            signer: signer.key,
            sponsor: signer.sponsor
        })
    }

    removeSignerSponsorship(signer) {
        this.effects.push({
            type: effectTypes.signerSponsorshipRemoved,
            account: this.before.address,
            signer: signer.key,
            prevSponsor: signer.sponsor
        })
    }

    updateSignerSponsorship(signer, prevSponsor) {
        this.effects.push({
            type: effectTypes.signerSponsorshipUpdated,
            account: this.after.address,
            signer: signer.key,
            sponsor: signer.sponsor,
            prevSponsor: prevSponsor
        })
    }
}


function analyzeSignerChanges(before, after) {
    return new SignerChangesAnalyzer(before, after).analyze()
}

module.exports = {analyzeSignerChanges}