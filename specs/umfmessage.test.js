/* eslint no-invalid-this: 0 */
/* eslint semi: ["error", "always"] */

require('./helpers/chai.js');

const UMFMessage = require('../lib/umfmessage');
const SECOND = 1000;

/**
* @name UMFMessage Tests
* @summary UMFMessage Test Suite
*/
describe('UMFMessage', function() {
  this.timeout(SECOND * 10);

  beforeEach(() => {
  });

  afterEach((done) => {
    done();
  });

  /**
  * @description Get a valid UMF message from a base long message
  */
  it('should instaniate a new UMF message from long form', (done) => {
    const inMessage = {
      'to': 'xxx',
      'from': 'yyy',
      'headers': 'aaa',
      'rmid': 'rmid123',
      'signature': 'sjm',
      'type': 'type-http',
      'via': 'uid:123',
      'timeout': 3000,
      'forward': 'yyy@aaa',
      'body': {
        'a': 'a',
        'b': 'b'
      },
      'authorization': 'secret'
    };
    const umfMessage = UMFMessage.createMessage((inMessage));
    expect(umfMessage).to.be.object;
    expect(umfMessage.validate()).to.be.true;
    done();
  });

  /**
  * @description Validate a bad message ..
  */
  it('should fail validation of a bad message - no to', (done) => {
    const inMessage = {
      'from': 'yyy',
      'body': {
        'a': 'a',
        'b': 'b'
      }
    };
    const umfMessage = UMFMessage.createMessage((inMessage));
    const pass = umfMessage.validate();
    expect(pass).to.be.false;
    done();
  });

  /**
  * @description Return JSON string of message ..
  */
  it('should return valid JSON string', (done) => {
    const inMessage = {
      'to': 'xxx',
      'from': 'yyy',
      'body': {
        'a': 'a',
        'b': 'b'
      }
    };
    const umfMessage = UMFMessage.createMessage((inMessage));
    const jsonMessage = umfMessage.toJSON();
    expect(jsonMessage).to.be.string;
    expect(jsonMessage).to.be.defined;
    done();
  });

  /**
  * @description Transform long messsage to short
  */
  it('should transform to a short message format', (done) => {
    const inMessage = {
      'to': 'xxx',
      'from': 'yyy',
      'headers': 'aaa',
      'rmid': 'rmid123',
      'signature': 'sjm',
      'type': 'type-http',
      'via': 'uid:123',
      'timeout': 3000,
      'forward': 'yyy@aaa',
      'body': {
        'a': 'a',
        'b': 'b'
      },
      'authorization': 'secret'
    };

    const umfMessage = UMFMessage.createMessage((inMessage));

    // Remove some fields to get coverage
    delete umfMessage.message.mid;
    delete umfMessage.message.timestamp;
    delete umfMessage.message.version;

    const shortMessage = umfMessage.toShort();
    expect(shortMessage).to.be.object;
    done();
  });

  /**
  * @description Transform empty long messsage to short
  */
  it('should transform empty message to a short message format', (done) => {
    const inMessage = {
    };
    const umfMessage = UMFMessage.createMessage((inMessage));
    const shortMessage = umfMessage.toShort();
    expect(shortMessage).to.be.object;
    done();
  });

  /**
  * @description Transform long messsage to short
  */
  it('should create valid message from short message format', (done) => {
    const inMessage = {
      'to': 'xxx',
      'frm': 'yyy',
      'hdr': 'aaa',
      'mid': 'mid123',
      'rmid': 'rmid123',
      'sig': 'sjm',
      'typ': 'type-http',
      'via': 'uid:123',
      'tmo': 3000,
      'ts': '2018-03-11T16:52:42.060Z',
      'ver': '1.2',
      'fwd': 'yyy@aaa',
      'bdy': {
        'a': 'a',
        'b': 'b'
      },
      'aut': 'secret'
    };
    const umfMessage = UMFMessage.createMessage((inMessage));
    expect(umfMessage).to.be.object;
    done();
  });

  /**
   * @description Create a short message id
   */
  it('should create short Message ID', (done) => {
    const inMessage = {
      'to': 'xxx',
      'from': 'yyy',
      'headers': 'aaa',
      'rmid': 'rmid123',
      'signature': 'sjm',
      'type': 'type-http',
      'timestamp': '2018-03-11T16:52:42.060Z',
      'version': '1.2',
      'via': 'uid:123',
      'timeout': 3000,
      'forward': 'yyy@aaa',
      'body': {
        'a': 'a',
        'b': 'b'
      },
      'authorization': 'secret'
    };
    const umfMessage = UMFMessage.createMessage((inMessage));
    const shortMessageId = umfMessage.createShortMessageID();
    expect(shortMessageId).to.be.defined;
    done();
  });

  /**
  * @description Create a signed message
  */
  it('should create a signature for the message', (done) => {
    const inMessage = {
      'to': 'xxx',
      'from': 'yyy',
      'headers': 'aaa',
      'mid': 'mid123',
      'rmid': 'rmid123',
      'type': 'type-http',
      'timestamp': '2018-03-11T16:52:42.060Z',
      'via': 'uid:123',
      'timeout': 3000,
      'forward': 'yyy@aaa',
      'signature': 'test',
      'body': {
        'a': 'a',
        'b': 'b'
      },
      'authorization': 'secret'
    };
    const umfMessage = UMFMessage.createMessage((inMessage));
    umfMessage.signMessage('sha256', 'testing');
    expect(umfMessage.signature).to.be.defined;
    expect(umfMessage.signature).to.be.equal('4796729993fe18df531d16668505b4fd6741c94c0a9db5116df214d7277d587d');
    done();
  });

  /**
  * @description Should return error for bad route
  */
  it('should return simple parsed route', (done) => {
    const parseObj = UMFMessage.parseRoute('uid:xxx123');
    expect(parseObj).to.be.object;
    expect(parseObj.error).to.be.empty;
    expect(parseObj.serviceName).to.equal('uid');
    expect(parseObj.apiRoute).to.equal('xxx123');
    done();
  });

  /**
  * @description Should return error for bad route
  */
  it('should return error for bad route', (done) => {
    const parseObj = UMFMessage.parseRoute('xx');
    expect(parseObj).to.be.object;
    expect(parseObj.error).to.not.be.empty;
    done();
  });

  /**
  * @description Should return parsed HTTP route
  */
  it('should return good http parsed route', (done) => {
    const parseObj = UMFMessage.parseRoute('http:/V1/URL/xxx123:route');
    expect(parseObj).to.be.object;
    expect(parseObj.error).to.be.empty;
    expect(parseObj.serviceName).to.equal('http:/V1/URL/xxx123');
    expect(parseObj.apiRoute).to.equal('route');
    done();
  });

  /**
  * @description Should return error for bad http route
  */
  it('should return error for bad http method route', (done) => {
    const parseObj = UMFMessage.parseRoute('http:/V1/URL/xxx123:[route');
    expect(parseObj).to.be.object;
    expect(parseObj.error).to.not.be.empty;
    done();
  });

  /**
  * @description Should return error for bad http route
  */
  it('should return valid parsed route with http method', (done) => {
    const parseObj = UMFMessage.parseRoute('http:/V1/URL/xxx123:[get]route');
    expect(parseObj).to.be.object;
    expect(parseObj.error).to.be.empty;
    expect(parseObj.httpMethod).to.equal('get');
    done();
  });

  /**
  * @description Should return route with @ in it
  */
  it('should return valid parsed route with @', (done) => {
    const parseObj = UMFMessage.parseRoute('test-subtest@service:xxx:yyy');
    expect(parseObj).to.be.object;
    expect(parseObj.error).to.be.empty;
    expect(parseObj.instance).to.equal('test');
    expect(parseObj.subID).to.equal('subtest');
    expect(parseObj.serviceName).to.equal('service');
    expect(parseObj.apiRoute).to.equal('xxx:yyy');
    done();
  });


  /**
  * @description Should return route with @ in it
  */
  it('should return valid parsed route with @ but no subid', (done) => {
    const parseObj = UMFMessage.parseRoute('test@service:xxx:yyy');
    expect(parseObj).to.be.object;
    expect(parseObj.error).to.be.empty;
    expect(parseObj.instance).to.equal('test');
    expect(parseObj.subID).to.be.empty;
    expect(parseObj.serviceName).to.equal('service');
    expect(parseObj.apiRoute).to.equal('xxx:yyy');
    done();
  });

  /**
  * @description Should return route with empty HTTP method
  */
  it('should return valid parsed route with @', (done) => {
    const parseObj = UMFMessage.parseRoute('http:/V1/URL/xxx123:[]route');
    expect(parseObj).to.be.object;
    expect(parseObj.error).to.be.empty;
    expect(parseObj.httpMethod).to.be.empty;
    done();
  });
});
