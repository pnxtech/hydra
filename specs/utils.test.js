/* eslint no-invalid-this: 0 */

require('./helpers/chai.js');

const Utils = require('../lib/utils');
const SECOND = 1000;


/**
* @name Utils Tests
* @summary Utils Test Suite
*/
describe('Utils', function() {
  this.timeout(SECOND * 10);

  beforeEach(() => {
  });

  afterEach((done) => {
    done();
  });


  /**
  * @description MD5 should return a valid MD5 hash
  */
  it('should return valid MD5 hash', (done) => {
    const myMD5 = Utils.md5Hash('TEST_KEY');
    expect(myMD5).to.be.equal('58cf16b25485a0116b85806bba9ca7e4');
    done();
  });

  /**
  * @description safeJSONStringy should return valid JSON string
  */
  it('should return valid JSON string', (done) => {
    const myData = {'key': 'test'};
    const myJSON = Utils.safeJSONStringify(myData);
    expect(myJSON).to.be.equal('{"key":"test"}');
    done();
  });

  /**
  * @description safeJSONStringy should stringify an Error object
  */
  it('should return valid JSON Error string', (done) => {
    const myError = new Error('OOPS');
    const myData = {'error': myError};
    const myJSON = Utils.safeJSONStringify(myData);
    expect(myJSON).to.include('OOPS');
    done();
  });

  /**
  * @description safeJSONParse should return valid JS data if valid JSON
  */
  it('should return valid JS data structure', (done) => {
    const myData = Utils.safeJSONParse('{"key" : "test"}');
    expect(myData.key).to.be.equal('test');
    done();
  });

  /**
  * @description safeJSONParse should return undefined if invalid JSON
  */
  it('should return valid undefined', (done) => {
    const myData = Utils.safeJSONParse('{"key" : ');
    expect(myData).to.be.undefined;
    done();
  });

  /**
  * @description stringHash should return a hash for a string
  */
  it('should return the a hash value for a string', (done) => {
    const myHash = Utils.stringHash('TEST_STRING');
    expect(myHash).to.be.equal(2282002681);
    done();
  });

  /**
  * @description shortID should return a random id from A-Z 0-9.
  */
  it('should return an id with only A-Z and 0-9', (done) => {
    const myID = Utils.shortID();
    expect(myID).to.be.defined;
    done();
  });

  /**
  * @description True for a valid UUID4 string.
  */
  it('should return true for valid UUID4 strings', (done) => {
    expect(Utils.isUUID4('ABCDEF12-BBBB-CCCC-dddd-1234567890AB')).to.be.true;
    done();
  });

  /**
  * @description False for an invalid UUID4 string.
  */
  it('should return false for an invalid UUID4 strings', (done) => {
    expect(Utils.isUUID4('XBCDEF12-BBBB-CCCC-dddd-1234567890AB')).to.be.false;
    done();
  });

  /**
  * @description Shuffle an array in place
  */
  it('should be able to shuffle an array in place', (done) => {
    const startArray = Array.from(Array(10).keys());
    const shuffleArray = startArray.slice();
    Utils.shuffleArray(shuffleArray);
    expect(shuffleArray).to.not.equal(startArray);
    done();
  });
});
