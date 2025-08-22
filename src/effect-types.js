/**
 * All supported effects types
 * @readonly
 */
const effectTypes = {
    feeCharged: 'feeCharged',

    accountCreated: 'accountCreated',
    accountRemoved: 'accountRemoved',

    accountDebited: 'accountDebited',
    accountCredited: 'accountCredited',

    accountHomeDomainUpdated: 'accountHomeDomainUpdated',
    accountThresholdsUpdated: 'accountThresholdsUpdated',
    accountFlagsUpdated: 'accountFlagsUpdated',
    accountInflationDestinationUpdated: 'accountInflationDestinationUpdated',

    accountSignerUpdated: 'accountSignerUpdated',
    accountSignerRemoved: 'accountSignerRemoved',
    accountSignerCreated: 'accountSignerCreated',

    trustlineCreated: 'trustlineCreated',
    trustlineUpdated: 'trustlineUpdated',
    trustlineRemoved: 'trustlineRemoved',
    trustlineAuthorizationUpdated: 'trustlineAuthorizationUpdated',

    assetMinted: 'assetMinted',
    assetBurned: 'assetBurned',

    liquidityPoolCreated: 'liquidityPoolCreated',
    liquidityPoolUpdated: 'liquidityPoolUpdated',
    liquidityPoolRemoved: 'liquidityPoolRemoved',

    offerCreated: 'offerCreated',
    offerUpdated: 'offerUpdated',
    offerRemoved: 'offerRemoved',

    trade: 'trade',

    inflation: 'inflation',

    sequenceBumped: 'sequenceBumped',

    dataEntryCreated: 'dataEntryCreated',
    dataEntryUpdated: 'dataEntryUpdated',
    dataEntryRemoved: 'dataEntryRemoved',

    claimableBalanceCreated: 'claimableBalanceCreated',
    claimableBalanceRemoved: 'claimableBalanceRemoved',

    liquidityPoolDeposited: 'liquidityPoolDeposited',
    liquidityPoolWithdrew: 'liquidityPoolWithdrew',

    accountSponsorshipCreated: 'accountSponsorshipCreated',
    accountSponsorshipUpdated: 'accountSponsorshipUpdated',
    accountSponsorshipRemoved: 'accountSponsorshipRemoved',

    trustlineSponsorshipCreated: 'trustlineSponsorshipCreated',
    trustlineSponsorshipUpdated: 'trustlineSponsorshipUpdated',
    trustlineSponsorshipRemoved: 'trustlineSponsorshipRemoved',

    offerSponsorshipCreated: 'offerSponsorshipCreated',
    offerSponsorshipUpdated: 'offerSponsorshipUpdated',
    offerSponsorshipRemoved: 'offerSponsorshipRemoved',

    dataSponsorshipCreated: 'dataSponsorshipCreated',
    dataSponsorshipUpdated: 'dataSponsorshipUpdated',
    dataSponsorshipRemoved: 'dataSponsorshipRemoved',

    claimableBalanceSponsorshipCreated: 'claimableBalanceSponsorshipCreated',
    claimableBalanceSponsorshipUpdated: 'claimableBalanceSponsorshipUpdated',
    claimableBalanceSponsorshipRemoved: 'claimableBalanceSponsorshipRemoved',

    liquidityPoolSponsorshipCreated: 'liquidityPoolSponsorshipCreated',
    liquidityPoolSponsorshipUpdated: 'liquidityPoolSponsorshipUpdated',
    liquidityPoolSponsorshipRemoved: 'liquidityPoolSponsorshipRemoved',

    signerSponsorshipCreated: 'signerSponsorshipCreated',
    signerSponsorshipUpdated: 'signerSponsorshipUpdated',
    signerSponsorshipRemoved: 'signerSponsorshipRemoved',

    contractCodeUploaded: 'contractCodeUploaded',
    contractCodeRemoved: 'contractCodeRemoved',
    contractCodeRestored: 'contractCodeRestored',

    contractCreated: 'contractCreated',
    contractUpdated: 'contractUpdated',
    contractRestored: 'contractRestored',

    contractInvoked: 'contractInvoked',
    contractError: 'contractError',

    contractDataCreated: 'contractDataCreated',
    contractDataUpdated: 'contractDataUpdated',
    contractDataRemoved: 'contractDataRemoved',
    contractDataRestored: 'contractDataRestored',

    contractEvent: 'contractEvent',
    contractMetrics: 'contractMetrics',

    setTtl: 'setTtl'
}

module.exports = effectTypes