/**
 * @name ServerResponse
 * @summary Class for handling server responses
 */
class ServerResponse {
  /**
  * @name constructor
  * @summary Class constructor
  * @return {undefined}
  */
  constructor() {
    this.testMode = false;
    this.corsEnabled = false;
    this.corsHeaders = {
      'access-control-allow-origin': '*'
    };
  }

  /**
  * @name setTestMode
  * @summary Set this module in test mode
  * @return {undefined}
  */
  setTestMode() {
    this.testMode = true;
  }

  /**
  * @name enableCORS
  * @summary Enable / Disable CORS support
  * @param {boolean} state - true if CORS should be enabled
  * @param {object} corsHeaders - request return cors headers
  * @return {undefined}
  */
  enableCORS(state, corsHeaders) {
    this.corsEnabled = state;
    if (corsHeaders) {
      this.corsHeaders = Object.assign(this.corsHeaders, corsHeaders);
    }
  }

  /**
  * @name createResponseObject
  * @summary Create a data response object.
  * @description This creates a consistently formatted HTTP response. It can be used
  *              with any of the server-response send methods in the data param.
  * @param {number} httpCode - HTTP code (Ex. 404)
  * @param {object} resultPayload - object with {result: somevalue}
  * @return {object} response - object suitable for sending via HTTP
  */
  createResponseObject(httpCode, resultPayload) {
    let status = ServerResponse.STATUS[httpCode] || [`${httpCode}`, `Unknown statusCode ${httpCode}`];
    let response = Object.assign({
      statusCode: httpCode,
      statusMessage: status[ServerResponse.STATUSMESSAGE],
      statusDescription: status[ServerResponse.STATUSDESCRIPTION],
      result: {}
    }, resultPayload || {});
    return response;
  }

  /**
   * @name sendResponse
   * @summary Send a server response to caller.
   * @param {number} code - HTTP response code
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {object} res - Returns the (res) response object when in test mode, else undefined
   */
  sendResponse(code, res, data) {
    let headers = {
      'Content-Type': 'application/json'
    };

    let response = Object.assign(this.createResponseObject(code), data || {});
    if (this.corsEnabled) {
      headers = Object.assign(headers, this.corsHeaders);
    }

    if (data) {
      headers = Object.assign(headers, data.headers);
    }

    let responseString = JSON.stringify(response);
    headers['Content-Length'] = Buffer.byteLength(responseString);

    res.writeHead(code, headers);
    res.write(responseString);
    res.end();
  }

  /**
   * @name sendOk
   * @summary Send an HTTP_OK server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendOk(res, data) {
    this.sendResponse(ServerResponse.HTTP_OK, res, data);
  }

  /**
   * @name sendCreated
   * @summary Send an HTTP_CREATED server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendCreated(res, data) {
    this.sendResponse(ServerResponse.HTTP_CREATED, res, data);
  }

  /**
   * @name sendNoContent
   * @summary Send an HTTP_NO_CONTENT server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendNoContent(res, data) {
    this.sendResponse(ServerResponse.HTTP_NO_CONTENT, res, data);
  }

  /**
   * @name sendMovedPermanently
   * @summary Send an HTTP_MOVED_PERMANENTLY server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendMovedPermanently(res, data) {
    this.sendResponse(ServerResponse.HTTP_MOVED_PERMANENTLY, res, data);
  }

  /**
   * @name sendInvalidRequest
   * @summary Send an HTTP_BAD_REQUEST server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendInvalidRequest(res, data) {
    this.sendResponse(ServerResponse.HTTP_BAD_REQUEST, res, data);
  }

  /**
   * @name sendInvalidUserCredentials
   * @summary Send an HTTP_UNAUTHORIZED server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendInvalidUserCredentials(res, data) {
    this.sendResponse(ServerResponse.HTTP_UNAUTHORIZED, res, data);
  }

  /**
   * @name sendPaymentRequired
   * @summary Send an HTTP_PAYMENT_REQUIRED server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendPaymentRequired(res, data) {
    this.sendResponse(ServerResponse.HTTP_PAYMENT_REQUIRED, res, data);
  }

  /**
   * @name sendForbidden
   * @summary Send an HTTP_FORBIDDEN server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendForbidden(res, data) {
    this.sendResponse(ServerResponse.HTTP_FORBIDDEN, res, data);
  }

  /**
   * @name sendNotFound
   * @summary Send an HTTP_NOT_FOUND server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendNotFound(res, data) {
    this.sendResponse(ServerResponse.HTTP_NOT_FOUND, res, data);
  }

  /**
   * @name sendInvalidSession
   * @summary Send an HTTP_BAD_REQUEST server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendInvalidSession(res, data) {
    this.sendResponse(ServerResponse.HTTP_BAD_REQUEST, res, data);
  }

  /**
   * @name sendRequestFailed
   * @summary Send an HTTP_SERVER_ERROR server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendRequestFailed(res, data) {
    this.sendResponse(ServerResponse.HTTP_SERVER_ERROR, res, data);
  }

  /**
   * @name sendDataConflict
   * @summary Send an HTTP_CONFLICT server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendDataConflict(res, data) {
    this.sendResponse(ServerResponse.HTTP_CONFLICT, res, data);
  }

  /**
   * @name sendTooLarge
   * @summary Send an HTTP_TOO_LARGE server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendTooLarge(res, data) {
    this.sendResponse(ServerResponse.HTTP_TOO_LARGE, res, data);
  }

  /**
   * @name sendTooManyRequests
   * @summary Send an HTTP_TOO_MANY_REQUEST server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendTooManyRequests(res, data) {
    this.sendResponse(ServerResponse.HTTP_TOO_MANY_REQUEST, res, data);
  }

  /**
   * @name sendServerError
   * @summary Send an HTTP_SERVER_ERROR server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendServerError(res, data) {
    this.sendResponse(ServerResponse.HTTP_SERVER_ERROR, res, data);
  }

  /**
   * @name sendInternalError
   * @summary Alias for sendServerError
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendInternalError(res, data) {
    this.sendServerError(res, data);
  }

  /**
   * @name sendMethodNotImplemented
   * @summary Send an HTTP_METHOD_NOT_IMPLEMENTED server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendMethodNotImplemented(res, data) {
    this.sendResponse(ServerResponse.HTTP_METHOD_NOT_IMPLEMENTED, res, data);
  }

  /**
   * @name sendConnectionRefused
   * @summary Send an HTTP_CONNECTION_REFUSED server response to caller.
   * @param {object} res - Node HTTP response object
   * @param {object} data - An object to send
   * @return {undefined}
   */
  sendUnavailableError(res, data) {
    this.sendResponse(ServerResponse.HTTP_CONNECTION_REFUSED, res, data);
  }
}

/**
 * Response codes.
 */
ServerResponse.HTTP_OK = 200;
ServerResponse.HTTP_CREATED = 201;
ServerResponse.HTTP_ACCEPTED = 202;
ServerResponse.HTTP_NO_CONTENT = 204;
ServerResponse.HTTP_MOVED_PERMANENTLY = 301;
ServerResponse.HTTP_FOUND = 302;
ServerResponse.HTTP_NOT_MODIFIED = 304;
ServerResponse.HTTP_BAD_REQUEST = 400;
ServerResponse.HTTP_UNAUTHORIZED = 401;
ServerResponse.HTTP_PAYMENT_REQUIRED = 402;
ServerResponse.HTTP_FORBIDDEN = 403;
ServerResponse.HTTP_NOT_FOUND = 404;
ServerResponse.HTTP_METHOD_NOT_ALLOWED = 405;
ServerResponse.NOT_ACCEPTABLE = 406;
ServerResponse.HTTP_CONFLICT = 409;
ServerResponse.HTTP_TOO_LARGE = 413;
ServerResponse.HTTP_TOO_MANY_REQUEST = 429;
ServerResponse.HTTP_SERVER_ERROR = 500;
ServerResponse.HTTP_METHOD_NOT_IMPLEMENTED = 501;
ServerResponse.HTTP_CONNECTION_REFUSED = 502;
ServerResponse.HTTP_SERVICE_UNAVAILABLE = 503;

ServerResponse.STATUSMESSAGE = 0;
ServerResponse.STATUSDESCRIPTION = 1;
ServerResponse.STATUS = {
  '200': ['OK', 'Request succeeded without error'],
  '201': ['Created', 'Resource created'],
  '202': ['Accepted', 'Request accepted'],
  '204': ['No Content', 'Resource has no content'],
  '301': ['Moved Permanently', 'Resource has been permanently moved'],
  '302': ['Found', 'Resource was found under another URI'],
  '304': ['Not Modified', 'Resource has not been modified'],
  '400': ['Bad Request', 'Request is invalid, missing parameters?'],
  '401': ['Unauthorized', 'User isn\'t authorized to access this resource'],
  '402': ['Payment Required', 'This code is reserved for future use.'],
  '403': ['Forbidden', 'The server understood the request but refuses to authorize it'],
  '404': ['Not Found', 'The requested resource was not found on the server'],
  '405': ['Method not allowed', 'The HTTP method used is not allowed'],
  '406': ['Not Acceptable', 'The target resource does not have a current representation that would be acceptable to the user agent'],
  '409': ['Conflict', 'Request has caused a conflict'],
  '413': ['Request Entity Too Large', 'The webserver or proxy believes the request is too large'],
  '429': ['Too Many Requests', 'Too many requests issue within a period'],
  '500': ['Server Error', 'An error occurred on the server'],
  '501': ['Method Not Implemented', 'The requested method / resource isn\'t implemented on the server'],
  '502': ['Connection Refused', 'The connection to server was refused'],
  '503': ['Service Unavailable', 'The server is currently unable to handle the request due to a temporary overloading or maintenance of the server']
};

module.exports = ServerResponse;
