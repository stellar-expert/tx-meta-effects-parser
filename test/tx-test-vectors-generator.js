const {createHash} = require('crypto')
const {
    TransactionBuilder,
    Server,
    Networks,
    Operation,
    Keypair,
    Asset,
    LiquidityPoolAsset,
    LiquidityPoolFeeV18,
    Claimant,
    AuthClawbackEnabledFlag,
    AuthRevocableFlag,
    getLiquidityPoolId
} = require('stellar-sdk')

/**
 * Generate test vectors for various combinations of transaction effects
 * @param {String} seed - Account id seed for reproducible generation
 * @param {String} network? - Network passphrase
 * @param {String} horizonUrl? - Horizon URL address
 * @param {Number} baseFee - Base fee amount
 * @return {Promise}
 */
async function generateTestVectors({
    seed,
    network = Networks.TESTNET,
    horizonUrl = 'https://horizon-testnet.stellar.org/',
    baseFee = 10000
}) {
    if (typeof baseFee === 'string') {
        baseFee = parseInt(baseFee, 10)
    }
    const horizon = new Server(horizonUrl, {allowHttp: true})
    const accountA = await createVectorAccount(seed, 'A', horizon)
    const accountB = await createVectorAccount(seed, 'B', horizon)
    const accountC = await createVectorAccount(seed, 'C', horizon)
    const accountD = await createVectorAccount(seed, 'D', horizon)

    const accountE = await createVectorAccount(seed, 'E', horizon, false)

    const XLM = Asset.native()

    const USDA_asset = new Asset('USD', accountA.address)
    const EURA_asset = new Asset('EUR', accountA.address)

    const USDB_asset = new Asset('USD', accountB.address)
    const EURB_asset = new Asset('EUR', accountB.address)

    const XLM_USDA_poolAsset = new LiquidityPoolAsset(
        Asset.native(),
        USDA_asset,
        LiquidityPoolFeeV18
    )

    const XLM_USDA_poolId = getLiquidityPoolId('constant_product',
        XLM_USDA_poolAsset.getLiquidityPoolParameters())
        .toString('hex')

    const USDA_EURA_poolAsset = new LiquidityPoolAsset(
        EURA_asset,
        USDA_asset,
        LiquidityPoolFeeV18
    )

    const USDA_EURA_poolId = getLiquidityPoolId('constant_product',
        USDA_EURA_poolAsset.getLiquidityPoolParameters())
        .toString('hex')


    const generalParams = {
        source: accountA,
        network,
        baseFee
    }

    async function exec(description, tx) {
        try {
            console.log(`\n${description}:\n`)
            const response = await horizon.submitTransaction(tx, {skipMemoRequiredCheck: true})

            if (response.error)
                throw new Error(response.error)
            console.log(JSON.stringify({
                hash: response.hash,
                envelope: response.envelope_xdr,
                result: response.result_xdr,
                meta: response.result_meta_xdr
            }, null, '  '))
        } catch (e) {
            console.error({
                error: `Tx failed: ${e.message}.`,
                ...(e?.response?.data?.extras || {})
            })
            throw new Error('See the error above.')
        }
    }

    await mergeAccount()

    await createAccount()

    await signers()

    //'op_not_supported'
    //await inflation()

    await setOptions()

    await payments()

    await trustlines()

    await liquidityPools()

    await dataEntries()

    await claimableBalances()

    await offers()

    await sponsorships()

    await feeBumpTx()

    async function feeBumpTx() {
        const innerTx = buildTransaction({
            ...generalParams,
            operations: [
                Operation
                    .payment({
                        destination: accountB.address,
                        asset: XLM,
                        amount: '1'
                    })
            ],
            signerKeys: [accountA.keypair]
        })

        await exec('fee bump transaction', buildFeeBumpTransaction({...generalParams, innerTx}))
    }

    async function sponsorships() {

        await accountA.reloadAccountInfo()
        await accountC.reloadAccountInfo()

        const tx = buildTransaction({
            ...generalParams,
            operations: [
                Operation
                    .beginSponsoringFutureReserves({
                        sponsoredId: accountE.address
                    }),
                Operation
                    .createAccount({
                        destination: accountE.address,
                        startingBalance: '0'
                    }),
                Operation
                    .setOptions({
                        signer: {
                            ed25519PublicKey: accountD.address,
                            weight: 1
                        },
                        setFlags: AuthRevocableFlag | AuthClawbackEnabledFlag,
                        source: accountE.address
                    }),
                Operation
                    .changeTrust({
                        asset: USDA_asset,
                        limit: '10000000',
                        source: accountE.address
                    }),
                Operation
                    .manageData({
                        name: 'test',
                        value: 'test',
                        source: accountE.address
                    }),
                Operation
                    .createClaimableBalance({
                        claimants: [
                            new Claimant(
                                accountA.address,
                                Claimant.predicateBeforeAbsoluteTime((new Date().getTime() + 1000000).toString())
                            )
                        ],
                        asset: new Asset('USD', accountE.address),
                        amount: '10',
                        source: accountE.address
                    }),
                Operation
                    .endSponsoringFutureReserves({
                        source: accountE.address
                    })
            ],
            signerKeys: [accountA.keypair, accountE.keypair]
        })

        const claimBalanceId = tx.getClaimableBalanceId(5)

        await exec('create sponsored account, add signer, create trustline, data entry, claimable balance using BeginSponsoringFutureReserves+EndSponsoringFutureReserves',
            tx
        )

        await exec('update sponsorship and then revoke it',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .beginSponsoringFutureReserves({
                            sponsoredId: accountA.address,
                            source: accountC.address
                        }),
                    Operation
                        .revokeSignerSponsorship({
                            account: accountE.address,
                            signer: {
                                ed25519PublicKey: accountD.address
                            }
                        }),
                    Operation
                        .revokeTrustlineSponsorship({
                            account: accountE.address,
                            asset: USDA_asset
                        }),
                    Operation
                        .revokeDataSponsorship({
                            account: accountE.address,
                            name: 'test'
                        }),
                    Operation
                        .revokeClaimableBalanceSponsorship({
                            balanceId: claimBalanceId
                        }),
                    Operation
                        .revokeAccountSponsorship({
                            account: accountE.address,
                            source: accountA.address
                        }),
                    Operation
                        .endSponsoringFutureReserves()
                ],
                signerKeys: [accountA.keypair, accountC.keypair]
            }))

        await exec('merge sponsored account',
            buildTransaction({
                ...generalParams,
                source: accountC,
                operations: [
                    Operation
                        .setOptions({
                            signer: {
                                ed25519PublicKey: accountD.address,
                                weight: 0
                            },
                            source: accountE.address
                        }),
                    Operation
                        .changeTrust({
                            asset: USDA_asset,
                            limit: '0',
                            source: accountE.address
                        }),
                    Operation
                        .manageData({
                            name: 'test',
                            value: null,
                            source: accountE.address
                        }),
                    Operation
                        .clawbackClaimableBalance({
                            balanceId: claimBalanceId,
                            source: accountE.address
                        }),
                    Operation
                        .accountMerge({
                            destination: accountC.address,
                            source: accountE.address
                        })
                ],
                signerKeys: [accountC.keypair, accountE.keypair]
            }))
    }

    async function offers() {
        await exec('create offer with ManageSellOffer, create offer with ManagePassiveSellOffer, create offer with ManageBuyOffer (partially cross previous order), deposit to liquidity pool, trade using PathPaymentStrictReceive through 2 orders, trade using PathPaymentStrictSend through an order and a pool',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .manageSellOffer({
                            selling: USDA_asset,
                            buying: XLM,
                            amount: '100',
                            price: 1
                        }),
                    Operation
                        .createPassiveSellOffer({
                            selling: EURA_asset,
                            buying: USDA_asset,
                            amount: '90',
                            price: '0.99'
                        }),
                    Operation.changeTrust({
                        asset: USDA_asset,
                        source: accountB.address
                    }),
                    Operation
                        .allowTrust({
                            trustor: accountB.address,
                            assetCode: USDA_asset.code,
                            authorize: 1,
                            source: accountA.address
                        }),
                    Operation
                        .manageBuyOffer({
                            selling: XLM,
                            buying: USDA_asset,
                            price: '1',
                            buyAmount: '10',
                            source: accountB.address
                        }),
                    Operation
                        .changeTrust({
                            asset: USDA_EURA_poolAsset,
                            limit: '10000000'
                        }),
                    Operation
                        .liquidityPoolDeposit({
                            liquidityPoolId: USDA_EURA_poolId,
                            maxAmountA: '100',
                            maxAmountB: '100',
                            minPrice: '0.1',
                            maxPrice: '10'
                        }),
                    Operation
                        .pathPaymentStrictReceive({
                            sendAsset: XLM,
                            sendMax: '200',
                            destination: accountA.address,
                            destAsset: EURA_asset,
                            destAmount: '90',
                            source: accountB.address,
                            path: [
                                USDA_asset,
                                EURA_asset
                            ]
                        }),
                    Operation
                        .pathPaymentStrictSend({
                            sendAsset: USDA_asset,
                            sendAmount: '10',
                            destAsset: EURA_asset,
                            destination: accountA.address,
                            destMin: '5',
                            source: accountB.address
                        }),
                    //it throws invalid limit error
                    //Operation
                    //.changeTrust({
                    //asset: USDA_EURA_poolAsset,
                    //limit: '0'
                    //}),
                    Operation.changeTrust({
                        asset: USDA_asset,
                        limit: '0',
                        source: accountB.address
                    })
                ],
                signerKeys: [accountA.keypair, accountB.keypair]
            }))


        await exec('create offer to update and remove it',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .createPassiveSellOffer({
                            selling: USDA_asset,
                            buying: XLM,
                            amount: '100',
                            price: 1
                        })
                ],
                signerKeys: [accountA.keypair]
            }))

        const lastOffers = await horizon
            .offers()
            .forAccount(accountA.address)
            .limit(1)
            .order('desc')
            .call()

        const lastOfferId = lastOffers.records[0].id

        console.log('lastOfferId', lastOfferId)

        await exec('update offer and remove offer',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .manageSellOffer({
                            selling: USDA_asset,
                            buying: XLM,
                            amount: '110',
                            price: 1,
                            offerId: lastOfferId
                        }),
                    Operation
                        .manageSellOffer({
                            selling: USDA_asset,
                            buying: XLM,
                            amount: '0',
                            price: 1,
                            offerId: lastOfferId
                        })
                ],
                signerKeys: [accountA.keypair]
            }))
    }

    async function claimableBalances() {
        const tx = buildTransaction({
            ...generalParams,
            operations: [
                Operation.createClaimableBalance({
                    claimants: [
                        new Claimant(accountB.address, Claimant.predicateBeforeAbsoluteTime((new Date().getTime() + 1000000).toString()))
                    ],
                    asset: XLM,
                    amount: '100'
                }),
                Operation.createClaimableBalance({
                    claimants: [
                        new Claimant(accountB.address, Claimant.predicateBeforeAbsoluteTime((new Date().getTime() + 1000000).toString()))
                    ],
                    asset: USDA_asset,
                    amount: '100'
                })
            ],
            signerKeys: [accountA.keypair]
        })


        await exec('create claimable balances', tx)

        const claimBalanceId1 = tx.getClaimableBalanceId(0)
        const claimBalanceId2 = tx.getClaimableBalanceId(1)
        await exec('claim claimable balance, clawback claimable balance',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .claimClaimableBalance({
                            balanceId: claimBalanceId1,
                            source: accountB.address
                        }),
                    Operation
                        .clawbackClaimableBalance({
                            balanceId: claimBalanceId2
                        })
                ],
                signerKeys: [accountA.keypair, accountB.keypair]
            }))
    }

    async function dataEntries() {
        await exec('create data entry, update data entry, remove data entry',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .manageData({
                            name: 'test',
                            value: 'test'
                        }),
                    Operation
                        .manageData({
                            name: 'test',
                            value: 'test2'
                        }),
                    Operation
                        .manageData({
                            name: 'test',
                            value: null
                        })
                ],
                signerKeys: [accountA.keypair]
            }))
    }

    async function liquidityPools() {
        await exec('deposit liquidity to the pool, withdraw 50%, withdraw the rest',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .changeTrust({
                            asset: XLM_USDA_poolAsset,
                            limit: '100000'
                        }),
                    Operation
                        .liquidityPoolDeposit({
                            liquidityPoolId: XLM_USDA_poolId,
                            maxAmountA: '1000',
                            maxAmountB: '1000',
                            minPrice: '0.1',
                            maxPrice: '10'
                        }),
                    Operation
                        .liquidityPoolWithdraw({
                            liquidityPoolId: XLM_USDA_poolId,
                            amount: '500',
                            minAmountA: '1',
                            minAmountB: '1'
                        }),
                    Operation
                        .liquidityPoolWithdraw({
                            liquidityPoolId: XLM_USDA_poolId,
                            amount: '500',
                            minAmountA: '500',
                            minAmountB: '500'
                        }),
                    Operation
                        .changeTrust({
                            asset: XLM_USDA_poolAsset,
                            limit: '0'
                        })
                ],
                signerKeys: [accountA.keypair]
            }))
    }

    async function trustlines() {
        await exec('create trustline, change limit, authorize trustline, deauthorize trustline, set trustline flags, clawback',
            buildTransaction({
                ...generalParams,
                source: accountB,
                operations: [
                    Operation
                        .changeTrust({
                            asset: USDA_asset,
                            limit: '100'
                        }),
                    Operation
                        .changeTrust({
                            asset: USDA_asset,
                            limit: '200'
                        }),
                    Operation
                        .allowTrust({
                            trustor: accountB.address,
                            assetCode: USDA_asset.code,
                            authorize: 1,
                            source: accountA.address
                        }),
                    Operation
                        .payment({
                            destination: accountB.address,
                            amount: '100',
                            asset: USDA_asset,
                            source: accountA.address
                        }),
                    Operation
                        .allowTrust({
                            trustor: accountB.address,
                            assetCode: USDA_asset.code,
                            authorize: 2,
                            source: accountA.address
                        }),
                    Operation
                        .setTrustLineFlags({
                            trustor: accountB.address,
                            asset: USDA_asset,
                            flags: {
                                authorizedToMaintainLiabilities: false
                            },
                            source: accountA.address
                        }),
                    Operation
                        .clawback({
                            from: accountB.address,
                            amount: '100',
                            asset: USDA_asset,
                            source: accountA.address
                        }),
                    //close trustline
                    Operation
                        .changeTrust({
                            asset: USDA_asset,
                            limit: '0'
                        })
                ],
                signerKeys: [accountA.keypair, accountB.keypair]
            }))
    }

    async function payments() {
        await exec('XLM payment, create trustline, asset payment',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .payment({
                            destination: accountB.address,
                            amount: '10',
                            asset: XLM
                        }),
                    Operation
                        .changeTrust({
                            asset: USDB_asset
                        }),
                    Operation
                        .payment({
                            destination: accountA.address,
                            amount: '100',
                            asset: USDB_asset,
                            source: accountB.address
                        }),
                    //send assets back to accountB to have ability to close trustline
                    Operation
                        .payment({
                            destination: accountB.address,
                            amount: '100',
                            asset: USDB_asset
                        }),
                    //close trustline
                    Operation
                        .changeTrust({
                            asset: USDB_asset,
                            limit: '0'
                        })
                ], signerKeys: [accountA.keypair, accountB.keypair]
            }))
    }

    async function setOptions() {
        await exec('set home domain, set inflation destination, set signer, set thresholds, set flags',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .setOptions({
                            inflationDest: accountB.address,
                            masterWeight: 4,
                            lowThreshold: 1,
                            medThreshold: 2,
                            highThreshold: 3,
                            homeDomain: 'test'
                        }),
                    //revert changes
                    Operation
                        .setOptions({
                            inflationDest: null,
                            masterWeight: 1,
                            lowThreshold: 0,
                            medThreshold: 0,
                            highThreshold: 0,
                            homeDomain: ''
                        })
                ],
                signerKeys: [accountA.keypair]
            }))
    }

    async function inflation() {
        await exec('inflation',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .inflation({})
                ],
                signerKeys: [accountA.keypair]
            }))
    }

    async function signers() {
        await exec('create signer',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .setOptions({
                            signer: {
                                ed25519PublicKey: accountB.address,
                                weight: 1
                            }
                        })
                ],
                signerKeys: [accountA.keypair]
            }))

        await exec('update signer',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .setOptions({
                            signer: {
                                ed25519PublicKey: accountB.address,
                                weight: 2
                            }
                        }),
                    Operation
                        .setOptions({
                            signer: {
                                ed25519PublicKey: accountB.address,
                                weight: 1
                            }
                        })
                ],
                signerKeys: [accountA.keypair]
            }))
        await exec('remove signer',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .setOptions({
                            signer: {
                                ed25519PublicKey: accountB.address,
                                weight: 0
                            }
                        })
                ],
                signerKeys: [accountA.keypair]
            }))
    }

    async function createAccount() {
        await exec('create account, set options, bump sequence, run inflation',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .createAccount({destination: accountB.address, startingBalance: '100'}),
                    Operation
                        .setOptions({
                            setFlags: AuthClawbackEnabledFlag | AuthRevocableFlag
                        }),
                    Operation
                        .bumpSequence({
                            bumpTo: '100',
                            source: accountB.address
                        })
                    //Todo: this operation is not supported by horizon
                    //Operation
                    //.inflation({
                    //source: accountB.address
                    //})
                ],
                signerKeys: [accountA.keypair, accountB.keypair]
            }))

        await accountB.reloadAccountInfo()
    }

    async function mergeAccount() {
        await exec('merge account',
            buildTransaction({
                ...generalParams,
                operations: [
                    Operation
                        .accountMerge({
                            destination: accountA.address,
                            source: accountB.address
                        })
                ],
                signerKeys: [accountA.keypair, accountB.keypair]
            }))
    }
}

/**
 * Create a keypair from a given seed+suffix combination
 * @param {String} seed
 * @param {String} suffix
 * @return {Keypair}
 */
function createSeededKeypair(seed, suffix) {
    const hash = createHash('sha256')
    hash.update(seed + 'test_acc' + suffix)
    return Keypair.fromRawEd25519Seed(hash.digest())
}


/**
 * Create or load test account for generating test vector transactions
 * @param {String} seed
 * @param {String} suffix
 * @param {Server} horizon
 * @return {Promise<TestVectorAccount>}
 * @internal
 */
async function createVectorAccount(seed, suffix, horizon, createIfNotExist = true) {
    const keypair = createSeededKeypair(seed, suffix)
    const address = keypair.publicKey()
    let accountInfo
    try {
        accountInfo = await horizon.loadAccount(address)
    } catch (e) {
        if (createIfNotExist) {
            await horizon.friendbot(address).call()
            accountInfo = await horizon.loadAccount(address)
        }
    }
    console.log(`Test vector account created: ${address}`)

    const account = {
        keypair,
        address,
        accountInfo
    }

    account.reloadAccountInfo = async () => {
        account.accountInfo = await horizon.loadAccount(account.address)
    }
    return account
}

/**
 * Build test vector transaction
 * @param {TestVectorAccount} source - Source account info
 * @param {Array<Operation>} operations - Operations to add
 * @param {Array<String>} extraSigners? - Extra signers to add
 * @param {Number} baseFee - Base fee amount for transaction
 * @param {String} network - Network passphrase
 * @returns {Transaction}
 * @internal
 */
function buildTransaction({source, operations, extraSigners, signerKeys = [], baseFee = 100000, network}) {
    const builder = getTxBuilder({
        source,
        operations,
        extraSigners,
        baseFee,
        network
    })

    const tx = builder.setTimeout(10000).build()
    for (const s of signerKeys) {
        tx.sign(s)
    }
    return tx
}

/**
 * Build test vector transaction
 * @param {TestVectorAccount} source - Source account info
 * @param {Array<Operation>} operations - Operations to add
 * @param {Array<String>} extraSigners? - Extra signers to add
 * @param {Number} baseFee - Base fee amount for transaction
 * @param {String} network - Network passphrase
 * @returns {Transaction}
 * @internal
 */
function getTxBuilder({source, operations, extraSigners, baseFee = 100000, network}) {
    const builder = new TransactionBuilder(source.accountInfo, {fee: baseFee, networkPassphrase: network})
    for (const op of operations) {
        builder.addOperation(op)
    }
    if (extraSigners && extraSigners.constructor === Array && extraSigners.length > 0) {
        builder.setExtraSigners(extraSigners)
    }

    return builder
}

/**
 * Build fee bump transaction
 * @param {Transaction} innerTx - Inner transaction to wrap
 * @param {TestVectorAccount} source - Source account info
 * @param {Number} baseFee - Tx base fee
 * @param {String} network - Network passphrase
 * @param {String} horizon - Horizon URL
 * @returns {FeeBumpTransaction}
 * @internal
 */
function buildFeeBumpTransaction({innerTx, source, baseFee, network}) {
    const tx = TransactionBuilder.buildFeeBumpTransaction(source.keypair, baseFee * 2, innerTx, network)
    tx.sign(source.keypair)
    return tx
}

/**
 * @typedef {{accountInfo: AccountResponse, address: String, keypair: Keypair, reloadAccountInfo: Promise<void>}} TestVectorAccount
 */

generateTestVectors.apply(null, process.argv.slice(2))
    .then(() => console.log('\n ✓ Done'))