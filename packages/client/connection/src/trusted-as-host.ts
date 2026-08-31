/**
 * Boot-time global carrying the Host's own declaration that this non-loopback
 * deployment is still safe to treat as reaching a privileged Host process.
 * Written into the served index page only when the Host's own
 * `ConnectionConfig.trustedAsHost` is true (see `index.ts`'s JSDoc for the
 * exact trust argument); read synchronously by the client connection plugin
 * before any plugin boots, the same pre-boot interval
 * `ClientTransportHooks.ownsHost` occupies for its own page-authored trust
 * declaration — but Host-emitted through `webserver/index-inject`
 * (`renderRow`'s `kind: 'global'` case renders `globalThis[name] = value`),
 * not page-authored, so a served page can never set this itself.
 */
export const TRUSTED_AS_HOST_GLOBAL = '__DSH_TRUSTED_AS_HOST__'
