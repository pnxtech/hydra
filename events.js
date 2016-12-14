'use strict';

/**
 * @name HydraEvent
 * @description EventEmitter event names for Hydra
 */
class HydraEvent {
  /**
   * @return {string} config update event
   * @static
   */
  static get CONFIG_UPDATE_EVENT() {
    return 'configUpdate';
  }
  /**
   * @return {string} update message type
   * @static
   */
  static get UPDATE_MESSAGE_TYPE() {
    return 'configRefresh';
  }
}

module.exports = HydraEvent;
