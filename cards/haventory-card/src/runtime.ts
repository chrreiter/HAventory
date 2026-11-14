/**
 * Everything a HAventory surface needs once one is on the page: the store, the
 * language catalogs and every `hv-*` element. `runtime-loader.ts` imports this
 * on demand, so a page with no card and no panel never downloads it.
 *
 * Nothing in the eager entry may import a value from here or from anything
 * below it; a type import is free. The build puts this module and its graph
 * into one lazy chunk.
 */
import './components/hv-card-shell';
import './components/hv-full-view';
import './haventory-card-editor';

export { Store } from './store/store';
export { setLanguage } from './i18n';
export { HostSurfaces } from './host-surfaces';
