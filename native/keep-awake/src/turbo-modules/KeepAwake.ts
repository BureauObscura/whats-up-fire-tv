import type {KeplerTurboModule} from '@amazon-devices/keplerscript-turbomodule-api';
import {TurboModuleRegistry} from '@amazon-devices/keplerscript-turbomodule-api';

export interface KeepAwake extends KeplerTurboModule {
  // Each returns '' on success, else the error text.
  start: () => string;
  stop: () => string;
}

export default TurboModuleRegistry.getEnforcing<KeepAwake>('KeepAwake');
