class TtlCache {
    /**
     * Create new instance of ClientCache with simple in-memory storage
     * @param {Number} ttl - Uniform time-to-live (in seconds)
     */
    constructor(ttl = 2 * 60) {
        this.ttl = ttl * 1000
        this.storage = new Map()
    }

    /**
     * @type {Number}
     */
    ttl
    /**
     * @type {Map<String,{ts:Number,value:*}>}
     * @private
     */
    storage
    /**
     * @type {Number}
     * @private
     */
    scheduledCleanup = 0

    /**
     * Try to retrieve an item from the cache
     * @param {String} key
     * @return {*}
     */
    get(key) {
        let item = this.storage.get(key)
        if (!item)
            return null
        item.ts = new Date().getTime()
        return item.value
    }

    /**
     * Add/replace cache object
     * @param {String} key - Unique key
     * @param {*} value - Associated value to store
     */
    set(key, value) {
        this.storage.set(key, {value, ts: new Date().getTime()})
        this.scheduleCleanup()
    }

    /**
     * @private
     */
    cleanupApiCache() {
        const {storage, ttl} = this
        const expired = new Date().getTime() - ttl
        for (const [key, item] of storage.entries()) {
            if (item.ts < expired) {
                storage.delete(key)
            }
        }
        this.scheduledCleanup = 0
        this.scheduleCleanup()
    }

    /**
     * @private
     */
    scheduleCleanup() {
        if (!this.scheduledCleanup && this.storage.size > 0) { //schedule new cleanup if storage is not empty
            this.scheduledCleanup = setTimeout(() => this.cleanupApiCache(), this.ttl + 10)
        }
    }

    /**
     * Stop scheduled cleanup task and free resources
     */
    dispose() {
        clearTimeout(this.scheduledCleanup)
        this.storage = null
    }
}

module.exports = TtlCache