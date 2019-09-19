'use strict';

const HydraEvent = require('./events');

/**
 * @name HydraPlugin
 * @description Extend this for hydra plugins
 */
class HydraPlugin {
  /**
  * @param {string} pluginName - unique name for the plugin
  */
  constructor(pluginName) {
    this.name = pluginName;
  }

  /**
  * @name setHydra
  * @param {object} hydra - hydra instance
  * @return {undefined}
  */
  setHydra(hydra) {
    this.hydra = hydra;
    this.hydra.on(HydraEvent.CONFIG_UPDATE_EVENT, (config) => this.updateConfig(config));
  }

  /**
  * @name setConfig
  * @param {object} hydraConfig - the hydra config
  * @return {undefined}
  */
  setConfig(hydraConfig) {
    this.hydraConfig = hydraConfig;
    this.opts = (hydraConfig.plugins && hydraConfig.plugins[this.name]) || {};
  }

  /**
   * @name updateConfig
   * @param {object} serviceConfig - the service-level config
   * @param {object} serviceConfig.hydra - the hydra-level config
   * @return {undefined}
   */
  updateConfig(serviceConfig) {
    this.serviceConfig = serviceConfig;
    this.hydraConfig = serviceConfig.hydra;
    let opts = (this.hydraConfig.plugins && this.hydraConfig.plugins[this.name]) || {};
    let isEqual = (JSON.stringify(this.opts) == JSON.stringify(opts));
    if (!isEqual) {
      this.configChanged(opts);
    }
  }

  /**
   * @name configChanged
   * @summary Handles changes to the plugin configuration
   * @param {object} opts - the new plugin config
   * @return {undefined}
   */
  configChanged(opts) {
    console.log(`[override] [${this.name}] handle changed config`);
    console.dir(opts, {colors: true, depth: null});
  }

  /**
   * @name onServiceReady
   * @summary Called by Hydra when the service has initialized, but before the init Promise resolves
   * @return {undefined}
   */
  onServiceReady() {
    console.log(`[override] [${this.name}] hydra service ready`);
  }
}

module.exports = HydraPlugin;
