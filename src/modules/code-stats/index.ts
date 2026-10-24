/**
 * Code Stats Module - /lines command and code-growth charts
 *
 * Split out of the admin module so the chart renderer (chartjs-node-canvas,
 * ~28 MB) is only loaded when this module is enabled.
 */

import { CodeStatsModule } from './module.js';

export default new CodeStatsModule();
export { CodeStatsModule };
