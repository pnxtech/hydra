/* eslint no-invalid-this: 0 */

require('./helpers/chai.js');

const Cache = require('../lib/cache');
const version = require('../package.json').version;
const SECOND = 1000;

let cache;

/**
* @name Cache Tests
* @summary Cache Test Suite
*/
describe('Cache', function() {
  this.timeout(SECOND * 10);

  beforeEach(() => {
    cache = new Cache();
  });

  afterEach((done) => {
    cache = null;
    done();
  });

  /**
  * @description Confirms that cache can put and get a value back within time
  */
  it('should be able to add new value to cache and get it back', (done) => {
    cache.put('KEY5', 5, SECOND * 5);
    let val = cache.get('KEY5');
    expect(val).to.equal(5);
    done();
  });

  /**
  * @description Confirms that cache will return undefined if not cached
  */
  it('should return undefined if not cached before', (done) => {
   let val = cache.get('NO_SUCH_KEY');
   expect(val).to.be.undefined;
   done();
  });

  /**
  * @description Confirms that cache will return undefined if expired
  */
  it('should return undefined if cache expired', (done) => {
    cache.put('KEY6', 6);
    setTimeout(() => {
      let val = cache.get('KEY6');
      expect(val).to.be.undefined;
      done();
    }, SECOND * 2);
  });
});