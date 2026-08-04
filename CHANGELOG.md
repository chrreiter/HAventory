# Changelog

## [0.3.1](https://github.com/chrreiter/HAventory/compare/v0.3.0...v0.3.1) (2026-08-04)


### Bug Fixes

* **card:** bring the full view's table up to the card's accessibility bar ([#253](https://github.com/chrreiter/HAventory/issues/253)) ([c553470](https://github.com/chrreiter/HAventory/commit/c55347020dab6e9cc3ac2d04afdc2b173e1a15d6))
* **card:** give every informational chip one shared style ([#262](https://github.com/chrreiter/HAventory/issues/262)) ([796baed](https://github.com/chrreiter/HAventory/commit/796baed62b9cd39a56fb8178f8aee3ed4a1f3f12))
* **config:** declare single_config_entry in the manifest ([#257](https://github.com/chrreiter/HAventory/issues/257)) ([c60868c](https://github.com/chrreiter/HAventory/commit/c60868ca76b10c9e7c47c8cf66bb255e9bdfbdb4)), closes [#233](https://github.com/chrreiter/HAventory/issues/233)
* **search:** let short query fragments match mid-word ([#251](https://github.com/chrreiter/HAventory/issues/251)) ([7d3aece](https://github.com/chrreiter/HAventory/commit/7d3aece19ece0e7025a642f004eba40f9658a18e)), closes [#220](https://github.com/chrreiter/HAventory/issues/220)
* **ws:** persist before broadcasting so an event implies a durable write ([#250](https://github.com/chrreiter/HAventory/issues/250)) ([0841a37](https://github.com/chrreiter/HAventory/commit/0841a37a31d47ecb3081175edc88084df9ca7855)), closes [#221](https://github.com/chrreiter/HAventory/issues/221) [#247](https://github.com/chrreiter/HAventory/issues/247)

## [0.3.0](https://github.com/chrreiter/HAventory/compare/v0.2.0...v0.3.0) (2026-08-03)


### Features

* allow filing locations under empty areas in organize dialog ([#185](https://github.com/chrreiter/HAventory/issues/185)) ([f6059fc](https://github.com/chrreiter/HAventory/commit/f6059fca684acba2aaf7f688fc9ad5f0fd94bc8a))
* **card:** make item status a table column and a sidebar facet ([#240](https://github.com/chrreiter/HAventory/issues/240)) ([3e1cefe](https://github.com/chrreiter/HAventory/commit/3e1cefefb8b4076e8d194962924c2b9531953ac2))
* item status field (OK / Missing / Needs Repair) ([#238](https://github.com/chrreiter/HAventory/issues/238)) ([a8982f6](https://github.com/chrreiter/HAventory/commit/a8982f6b3a9075598b1a351b520d2b522fd3a365))


### Documentation

* make CLAUDE.md release-stable and re-verify its claims ([#215](https://github.com/chrreiter/HAventory/issues/215)) ([336cc58](https://github.com/chrreiter/HAventory/commit/336cc584e3dc7cec0f855c277b09e255ad0026aa)), closes [#213](https://github.com/chrreiter/HAventory/issues/213)
* point already-open tabs at a reload or the sidebar entry after install ([#237](https://github.com/chrreiter/HAventory/issues/237)) ([7349037](https://github.com/chrreiter/HAventory/commit/7349037ba40ea7a59e884d444e97e0f1ea7be883))

## [0.2.0](https://github.com/chrreiter/HAventory/compare/v0.1.1...v0.2.0) (2026-08-03)


### Features

* **card:** embedded full view, haventory-panel, and shared host surfaces ([#159](https://github.com/chrreiter/HAventory/issues/159)) ([08218f0](https://github.com/chrreiter/HAventory/commit/08218f0b87a6ac83d20ef8f19c22731d84fc1800))
* **card:** follow Home Assistant's area registry (item 75) ([#165](https://github.com/chrreiter/HAventory/issues/165)) ([04ff0b3](https://github.com/chrreiter/HAventory/commit/04ff0b3fbe9f16d2b3a381e93f303923ffd6ba1e))
* **card:** preview what the location editor's area select does (item 46) ([#172](https://github.com/chrreiter/HAventory/issues/172)) ([f699e3d](https://github.com/chrreiter/HAventory/commit/f699e3d6bcab2d73ef842cb37cb70a5598921d27))
* **card:** show an item's area everywhere a location is printed (item 38) ([#162](https://github.com/chrreiter/HAventory/issues/162)) ([9180d8f](https://github.com/chrreiter/HAventory/commit/9180d8f5cca371640d1571b38c459ab6716a9dca))
* **config:** name the card in the config flow ([#157](https://github.com/chrreiter/HAventory/issues/157)) ([1510959](https://github.com/chrreiter/HAventory/commit/15109591b5b0f3ed8888673c295e992a243e26ec))
* **frontend:** give the sidebar entry the HAventory mark ([#183](https://github.com/chrreiter/HAventory/issues/183)) ([65dd4c8](https://github.com/chrreiter/HAventory/commit/65dd4c81a7d2780a9a690db14f60e78a6a7c7e31))
* **frontend:** register HAventory as a sidebar panel ([#160](https://github.com/chrreiter/HAventory/issues/160)) ([d65ff64](https://github.com/chrreiter/HAventory/commit/d65ff6402240aabda18f924b86eaea5e636c4d71))
* **skill:** shoot the sidebar panel with the screenshot harness (item 69) ([#170](https://github.com/chrreiter/HAventory/issues/170)) ([e93f4a9](https://github.com/chrreiter/HAventory/commit/e93f4a9e13e7be6178d5b26e907e827f9bd640eb))
* sweep files an earlier release left in the install directory (item 57) ([#169](https://github.com/chrreiter/HAventory/issues/169)) ([7597f5e](https://github.com/chrreiter/HAventory/commit/7597f5e7034431db67f9cb888dffa2bd48315f64))


### Bug Fixes

* **api:** refuse WebSocket commands after config-entry removal ([#171](https://github.com/chrreiter/HAventory/issues/171)) ([22d6528](https://github.com/chrreiter/HAventory/commit/22d6528bbff8715667aeeeb1d06fedd39487e32e))
* **api:** refuse while no config entry is loaded, and let the card recover ([#176](https://github.com/chrreiter/HAventory/issues/176)) ([6a779d6](https://github.com/chrreiter/HAventory/commit/6a779d6dd8ad4279f8382f1b2969f86d07e905b6))
* **card:** announce filter state on the desktop panel's chips (item 34) ([#167](https://github.com/chrreiter/HAventory/issues/167)) ([0583c29](https://github.com/chrreiter/HAventory/commit/0583c295e782028882a053140730f698aa56a337))
* **card:** announce only the filter surface the width uses, and no aria-expanded on leaves ([#179](https://github.com/chrreiter/HAventory/issues/179)) ([1c0c1a9](https://github.com/chrreiter/HAventory/commit/1c0c1a9818ecb8e4971a5511200e8603a2d01c95))
* **card:** say what a filter disclosure opens, and paint the sheet's rows as toggles ([#174](https://github.com/chrreiter/HAventory/issues/174)) ([4d005fd](https://github.com/chrreiter/HAventory/commit/4d005fdb5a3e53327f42fe7dec85000483084999))
* **card:** say what every remaining disclosure opens ([#177](https://github.com/chrreiter/HAventory/issues/177)) ([28f5ccd](https://github.com/chrreiter/HAventory/commit/28f5ccd9d3a288e85caf9f83f235ef3873707b78))
* **card:** size the area chip like the tree rows it heads ([#181](https://github.com/chrreiter/HAventory/issues/181)) ([67ef6bb](https://github.com/chrreiter/HAventory/commit/67ef6bb2ebf9c52c818fed13bf3b9c28ea8039f9))
* **e2e:** let the live-update smoke discover the view holding the card ([#182](https://github.com/chrreiter/HAventory/issues/182)) ([6fd4d9d](https://github.com/chrreiter/HAventory/commit/6fd4d9d15fe971a084c9d299f83f5776243ef2c2))
* location rename must not bump subtree item versions (item 23) ([#168](https://github.com/chrreiter/HAventory/issues/168)) ([9d1daa7](https://github.com/chrreiter/HAventory/commit/9d1daa702345c61fcf5897146db2ffb4f114c74f))
* **skill:** ask the instance where the card lives instead of hard-coding it ([#178](https://github.com/chrreiter/HAventory/issues/178)) ([c2f99ce](https://github.com/chrreiter/HAventory/commit/c2f99ce2027da3000db9b2316060b5bc0a946103))
* **skill:** point the screenshot harness at the dashboard the card lives on ([#175](https://github.com/chrreiter/HAventory/issues/175)) ([3607706](https://github.com/chrreiter/HAventory/commit/36077061a989b03f7d8414843b763035ca05959d))
* **skill:** submit the options form the way the flow shapes it ([#180](https://github.com/chrreiter/HAventory/issues/180)) ([5a8521e](https://github.com/chrreiter/HAventory/commit/5a8521e6e21a17614d845ab6788a55360388f4e5))


### Documentation

* **open-items:** collect and triage [#162](https://github.com/chrreiter/HAventory/issues/162)'s open items ([#163](https://github.com/chrreiter/HAventory/issues/163)) ([ea95457](https://github.com/chrreiter/HAventory/commit/ea9545731b35346aa0cf661c46207460880448f7))
* **open-items:** reconcile the ledger after the v0.2.0 payload batch ([#173](https://github.com/chrreiter/HAventory/issues/173)) ([6908efc](https://github.com/chrreiter/HAventory/commit/6908efc1e07f30cfe9abea19e7d11e9e6bac77a3))
* **open-items:** reconcile the ledger and re-scope pre-v1.0 ([#161](https://github.com/chrreiter/HAventory/issues/161)) ([8eb844a](https://github.com/chrreiter/HAventory/commit/8eb844a687f620af52e7f737674e684c3d2ed695))
* plan the sidebar panel for the post-Overview-redesign frontend ([#156](https://github.com/chrreiter/HAventory/issues/156)) ([0464966](https://github.com/chrreiter/HAventory/commit/04649664dfa08edf5d931832800542b85dead6f8))

## [0.1.1](https://github.com/chrreiter/HAventory/compare/v0.1.0...v0.1.1) (2026-07-31)


### Bug Fixes

* **card:** survive Home Assistant's custom element registry swap ([#151](https://github.com/chrreiter/HAventory/issues/151)) ([ea416df](https://github.com/chrreiter/HAventory/commit/ea416df277de1018d4b147b224484b2d16414a78))

## [0.1.0](https://github.com/chrreiter/HAventory/compare/v0.0.1...v0.1.0) (2026-07-31)


### ⚠ BREAKING CHANGES

* **card:** replace the proof-of-concept UI with the revamped card ([#111](https://github.com/chrreiter/HAventory/issues/111))
* **storage:** DomainStore.async_load now raises StorageError for corrupted payloads or failed migrations instead of silently returning an empty dataset. This surfaces configuration/migration issues early during setup.

### Features

* **areas:** add list_areas function to retrieve area information ([38bbbaf](https://github.com/chrreiter/HAventory/commit/38bbbaf8973091af521de872220bb7ca00067615))
* **areas:** enhance area registry retrieval for compatibility with async and sync contexts ([b608a0c](https://github.com/chrreiter/HAventory/commit/b608a0ccb3dc04677134ad80144e58233abeb7c8))
* auto-register HAventory card as Lovelace resource ([8899122](https://github.com/chrreiter/HAventory/commit/8899122acf0ad22979ef1eb9e618534a9d34933b))
* auto-register HAventory card asset ([0861c0d](https://github.com/chrreiter/HAventory/commit/0861c0d920740d6c854a6b7896fc770cd186c5ae))
* Auto-register HAventory card in Lovelace ([3c37d14](https://github.com/chrreiter/HAventory/commit/3c37d14af323525bdfb4612d5f6ef333d7843ca5))
* **card:** category/tag autocomplete in the item dialog ([#82](https://github.com/chrreiter/HAventory/issues/82)) ([5d6ba5f](https://github.com/chrreiter/HAventory/commit/5d6ba5f27bd617bdb438e0aec8a426ce416c8916))
* **card:** dedicated category browser with drill-down ([#83](https://github.com/chrreiter/HAventory/issues/83)) ([af9e42e](https://github.com/chrreiter/HAventory/commit/af9e42e4dab0df0e393f74ade866fa9f093712e5))
* **card:** dedicated tag browser with drill-down ([#84](https://github.com/chrreiter/HAventory/issues/84)) ([314cdca](https://github.com/chrreiter/HAventory/commit/314cdcac9aa77f1374f3a746ea5f1ee4a26bfc84))
* **card:** replace the proof-of-concept UI with the revamped card ([#111](https://github.com/chrreiter/HAventory/issues/111)) ([20ff2d6](https://github.com/chrreiter/HAventory/commit/20ff2d6f7ad5c17084ce6f30abfdc0ec82732be2))
* **card:** user-selectable list columns, persisted ([#85](https://github.com/chrreiter/HAventory/issues/85)) ([303f960](https://github.com/chrreiter/HAventory/commit/303f9608ab683872f1b694e3e47b2447be3ceb37))
* **ci:** enable release automation and check the version agrees everywhere ([#142](https://github.com/chrreiter/HAventory/issues/142)) ([a5e98e3](https://github.com/chrreiter/HAventory/commit/a5e98e3513f23b4a0fb8b1949ff8c00597344a04))
* **ci:** package the integration as a HACS zip release asset ([#148](https://github.com/chrreiter/HAventory/issues/148)) ([0278268](https://github.com/chrreiter/HAventory/commit/02782681a0e4fc52bc7c0296149e26ec60812fb6))
* create and edit locations directly from the HAventory card ([e06b00b](https://github.com/chrreiter/HAventory/commit/e06b00b531074b0460cbca809d30399c68a4020c))
* custom-fields UI in the item dialog + distinct field keys ([#86](https://github.com/chrreiter/HAventory/issues/86)) ([d9ee375](https://github.com/chrreiter/HAventory/commit/d9ee37595cc11e6f30b37ac0e52714946cfbb255))
* **frontend:** add location editing support ([47470b1](https://github.com/chrreiter/HAventory/commit/47470b1f01570def2a242ad8d274ce381f457855))
* **frontend:** enhance location selector with area context display ([8fb9c63](https://github.com/chrreiter/HAventory/commit/8fb9c6373dc0fe4fb730867a44963539952ab7dd))
* **frontend:** improve location creation UX with area assignment ([8b0b388](https://github.com/chrreiter/HAventory/commit/8b0b388591cf4968b506f2b76afaed0d4d309415))
* **frontend:** update location property to include area_id ([a378ead](https://github.com/chrreiter/HAventory/commit/a378ead166058bfb682610dec0bfb36f36c70cf0))
* **haventory:** complete Phase 1 — initial backend integration and dev add-on ([#11](https://github.com/chrreiter/HAventory/issues/11)) ([ac3a415](https://github.com/chrreiter/HAventory/commit/ac3a4157979cac75e3c3f7631458edb89e917d81))
* JSON import/export for backup & restore (WP3.5) ([#89](https://github.com/chrreiter/HAventory/issues/89)) ([d05639d](https://github.com/chrreiter/HAventory/commit/d05639d34d5f999e598df60952a98f239786ec5d))
* **models:** add area_id to Location and ItemFilter ([3dbf329](https://github.com/chrreiter/HAventory/commit/3dbf3291a6b0ced3781dc9c9344bf6fe7f64ba58))
* **repository, ws:** enhance location management with area_id support ([c48f292](https://github.com/chrreiter/HAventory/commit/c48f292190ac703189df2f5eb460a7760574b8bd))
* **repository:** add O(1) location hierarchy index and filtering ([#42](https://github.com/chrreiter/HAventory/issues/42)) ([3882dbc](https://github.com/chrreiter/HAventory/commit/3882dbcdb3313f063948149e9adbf07ac014daaf))
* **repository:** enhance area indexing for locations and items ([da0afaa](https://github.com/chrreiter/HAventory/commit/da0afaa33a0c66ff91a06694a508b512cf58ef45))
* **repository:** implement area propagation for location management ([8623da1](https://github.com/chrreiter/HAventory/commit/8623da1a39289dc2d0476d1b21c761625a95e6b7))
* **scripts:** add backend stress test for persistence and concurrency ([2253f41](https://github.com/chrreiter/HAventory/commit/2253f41fb36cd62ca9ad3e28bbe45a282866ed0f))
* serve the Lovelace card from the integration package ([#147](https://github.com/chrreiter/HAventory/issues/147)) ([ea8d038](https://github.com/chrreiter/HAventory/commit/ea8d038513c27762fcc861c85923189679ef628b))
* **services:** expose area_id for location_create and location_update ([dd3ceec](https://github.com/chrreiter/HAventory/commit/dd3ceecf1efeb5f279be137c1e1baeba468037ca))
* set the minimum supported Home Assistant version to 2026.3.1 ([#141](https://github.com/chrreiter/HAventory/issues/141)) ([876e0ae](https://github.com/chrreiter/HAventory/commit/876e0ae7caec50e324ec0affa542d01d476bf65e))
* settle inspection_date as the next inspection due, with a count, filter and card surfaces ([#133](https://github.com/chrreiter/HAventory/issues/133)) ([5198570](https://github.com/chrreiter/HAventory/commit/5198570d4eb5982fccbf239790b35dc14b46e1df))
* **storage:** add startup health check for storage integrity ([2adcc2e](https://github.com/chrreiter/HAventory/commit/2adcc2e9ebbaebb985c05e4ae3b305beba92bef6))
* **storage:** add startup health check for storage integrity ([3ac56f9](https://github.com/chrreiter/HAventory/commit/3ac56f94103f5a6c3e7cfd093f320bb0d452f557))
* **tests:** add online test for area registry e2e creation ([ef5696d](https://github.com/chrreiter/HAventory/commit/ef5696dd7597539704457beaf02372daf0688542))
* **tests:** add online test for areas/list and location area_id validation ([46cec3b](https://github.com/chrreiter/HAventory/commit/46cec3bd5ae4b0cf965dba44a973e7b4c3ec32bf))
* **tests:** enable area mutations for online tests ([f106bb5](https://github.com/chrreiter/HAventory/commit/f106bb56e98861bc278cc6821d7fca51810fedd7))
* **tests:** enhance offline tests for area and location management ([e8a5039](https://github.com/chrreiter/HAventory/commit/e8a5039f4fa6c58d0c531d796511d618c52147f4))
* WP2 backend-parity UI (date sorts, location delete/move, health panel, orphans filter) ([#79](https://github.com/chrreiter/HAventory/issues/79)) ([2390498](https://github.com/chrreiter/HAventory/commit/23904988c5bad9ce9fcba18e9a224ea86c08f8ce))
* WP4 stability hardening ([#91](https://github.com/chrreiter/HAventory/issues/91)) ([390cba6](https://github.com/chrreiter/HAventory/commit/390cba6c3f41f972acc0f60c070523fd30230412))
* **ws:** add distinct_values command for categories and tags ([#81](https://github.com/chrreiter/HAventory/issues/81)) ([bcd0e31](https://github.com/chrreiter/HAventory/commit/bcd0e31c58af106f05dfb02252fec2f48ec4488f))
* **ws:** add per-location item counts and filtered list totals ([#104](https://github.com/chrreiter/HAventory/issues/104)) ([37d1e59](https://github.com/chrreiter/HAventory/commit/37d1e596f2f16da2b73d0da5d5c7c36119aca3a2))


### Bug Fixes

* add null check for lovelace_data.resources ([11d933a](https://github.com/chrreiter/HAventory/commit/11d933ae47c13851053569316c5effaf09886d53))
* cache-bust the Lovelace card resource URL ([#122](https://github.com/chrreiter/HAventory/issues/122)) ([4dee9dd](https://github.com/chrreiter/HAventory/commit/4dee9dd643bd9fa32ead96010e522173ab323817))
* **card:** make the table's select-all checkbox visible before it is used ([#130](https://github.com/chrreiter/HAventory/issues/130)) ([7116138](https://github.com/chrreiter/HAventory/commit/71161388170810823b865c8674af1d38ec463c78))
* **card:** open the import sheet from the empty state and stop clipping the overflow menu ([#119](https://github.com/chrreiter/HAventory/issues/119)) ([f3b77b3](https://github.com/chrreiter/HAventory/commit/f3b77b3902c51d325a9f498d572427511f094ef4))
* **card:** reflect live inventory changes from WS subscriptions ([#93](https://github.com/chrreiter/HAventory/issues/93)) ([ab49a1a](https://github.com/chrreiter/HAventory/commit/ab49a1a31a1d59c38970289bc490f09220a9c2f4))
* **card:** retry a rate-limited subscribe and show that live updates are paused ([#128](https://github.com/chrreiter/HAventory/issues/128)) ([4082f76](https://github.com/chrreiter/HAventory/commit/4082f76b72474d937180f1d43e7ea185a9dd7b00))
* **card:** say what the location area dropdown's default option does ([#126](https://github.com/chrreiter/HAventory/issues/126)) ([deac2b4](https://github.com/chrreiter/HAventory/commit/deac2b4d2ca6f8466e998c9d80c3a7ebbee3a444))
* **card:** stop the import sheet promising Replace deletes ([#113](https://github.com/chrreiter/HAventory/issues/113)) ([57aa632](https://github.com/chrreiter/HAventory/commit/57aa632232ff1cb2e28830427bf5453b6bf87db0))
* CI formatting gate + non-destructive online smoke tests ([#90](https://github.com/chrreiter/HAventory/issues/90)) ([4cf79fd](https://github.com/chrreiter/HAventory/commit/4cf79fd3793b5d1eb7e39905a95c708e3220d3ee))
* **ci:** pin scorecard/codeql actions to real commit SHAs ([#77](https://github.com/chrreiter/HAventory/issues/77)) ([f4ffeb5](https://github.com/chrreiter/HAventory/commit/f4ffeb57ccfa6ba08b199c7db68a3fc951817258))
* **init:** clean up the Lovelace resource on config-entry removal ([#121](https://github.com/chrreiter/HAventory/issues/121)) ([c3d6223](https://github.com/chrreiter/HAventory/commit/c3d6223031d853568af1deaa45771849066baa4d))
* **init:** read the card's cache-buster version off the loop ([#132](https://github.com/chrreiter/HAventory/issues/132)) ([bbbdf42](https://github.com/chrreiter/HAventory/commit/bbbdf4248a5b40f74eaa363dfc32e53dc183c038))
* **logging:** log client-recoverable rejections at WARNING without a traceback ([#124](https://github.com/chrreiter/HAventory/issues/124)) ([c5f2b6a](https://github.com/chrreiter/HAventory/commit/c5f2b6a82b701d822cfbb2148478d071928be1bf))
* make the list_items post-filter accent-insensitive (NFKD) ([#75](https://github.com/chrreiter/HAventory/issues/75)) ([ec86cbd](https://github.com/chrreiter/HAventory/commit/ec86cbd32961f1132088484133aa69a7c9a6ba25))
* match the card's Lovelace resource by path, not by exact URL ([#114](https://github.com/chrreiter/HAventory/issues/114)) ([87784b5](https://github.com/chrreiter/HAventory/commit/87784b5ea2f111a6a3173d40cf7b0a52975f4eea))
* prevent data loss from concurrent persistence and bulk operation failures ([ddab483](https://github.com/chrreiter/HAventory/commit/ddab48310b1e65ee2d428c42280d9116dc29b55f))
* **scripts:** deploy via reload_addon.sh in stress_test.py ([#99](https://github.com/chrreiter/HAventory/issues/99)) ([263b471](https://github.com/chrreiter/HAventory/commit/263b471a1d8c8453380d8bbf8530a2ad9f261437))
* **services:** await service handlers instead of dropping them on the executor ([#136](https://github.com/chrreiter/HAventory/issues/136)) ([2e92885](https://github.com/chrreiter/HAventory/commit/2e92885c27e7e80ea86d097156882f92c99c888b))
* **services:** surface service errors and cleanup WebSocket subscriptions ([07bc8ff](https://github.com/chrreiter/HAventory/commit/07bc8ffb84bb02ec8a0841cba14d44a123395d53))
* **services:** surface service errors to users ([356569e](https://github.com/chrreiter/HAventory/commit/356569e03b07af8a30025f6c26a19b7d7b636ba9))
* **storage:** call migration function and add startup health check ([5d4b4d7](https://github.com/chrreiter/HAventory/commit/5d4b4d7251a262953aa150ac2d1247ba6ec09a3d))
* **storage:** call migration function instead of assigning reference ([b22522c](https://github.com/chrreiter/HAventory/commit/b22522c24cb13b88af281d952ced8007636ced47))
* **storage:** pin HA Store version and fix WS subscription dict ([d431916](https://github.com/chrreiter/HAventory/commit/d431916cf84265b1c80cfbfa478d03bc91c62174))
* **storage:** refuse a schema downgrade instead of relabelling newer data ([#120](https://github.com/chrreiter/HAventory/issues/120)) ([7d875fd](https://github.com/chrreiter/HAventory/commit/7d875fd1225f0f701c425a20d2d099d82eb5f078))
* **storage:** schedule the debounced persist as an HA tracked task ([#123](https://github.com/chrreiter/HAventory/issues/123)) ([2064815](https://github.com/chrreiter/HAventory/commit/206481555ad360dd586d1bee7da5c1549d4f64b5))
* **storage:** use constant HA Store version to avoid migration errors ([1c59e7e](https://github.com/chrreiter/HAventory/commit/1c59e7e1949708bede22b7888fdbf4c6ba08b577))
* **tests:** stop using deprecated asyncio event loop policy APIs on Windows ([#106](https://github.com/chrreiter/HAventory/issues/106)) ([1ccd090](https://github.com/chrreiter/HAventory/commit/1ccd090f84396919344d920722fbd7e43df32f83))
* **ws:** add cleanup for WebSocket subscriptions on connection close ([ad14920](https://github.com/chrreiter/HAventory/commit/ad14920b450c5a8976f7d3e4f05857d7b09010c5))
* **ws:** add missing area_id to location/tree endpoint ([cb2eec1](https://github.com/chrreiter/HAventory/commit/cb2eec1f4d2358fc792d43cf0b9d11dd85d050a2))
* **ws:** register subscriptions in HA's connection registry for clean teardown ([#94](https://github.com/chrreiter/HAventory/issues/94)) ([2d47d43](https://github.com/chrreiter/HAventory/commit/2d47d43df223fecbf2cc8ddd6d7d1bba117bc6af))
* **ws:** stop stamping a slotted attribute on ActiveConnection ([#97](https://github.com/chrreiter/HAventory/issues/97)) ([1e69a53](https://github.com/chrreiter/HAventory/commit/1e69a53aa45d54e2d3d5fe01d628b4efe686a350))
* **ws:** use regular dict for subscriptions bucket ([2c98657](https://github.com/chrreiter/HAventory/commit/2c98657e67be5149beb2cc3382af4f882c914979))


### Documentation

* add v1.0 release testing plan and release-readiness open items ([#112](https://github.com/chrreiter/HAventory/issues/112)) ([3f84771](https://github.com/chrreiter/HAventory/commit/3f8477123ed9decf5a8a5bd95b36a4ea9c9af077))
* **api:** correct check_out due_date to optional, matching the schema ([#105](https://github.com/chrreiter/HAventory/issues/105)) ([1ebbaa7](https://github.com/chrreiter/HAventory/commit/1ebbaa7395973cc9bdfc94c88f6b3329b2a2b2db))
* backend_api_contract, data_shapes, frontend_architecture; README noted. ([d9ee375](https://github.com/chrreiter/HAventory/commit/d9ee37595cc11e6f30b37ac0e52714946cfbb255))
* catalog open items from closed PRs (impact/effort, pre/post-v1.0) ([#92](https://github.com/chrreiter/HAventory/issues/92)) ([83558ae](https://github.com/chrreiter/HAventory/commit/83558ae4a55e8bc4091249fbb2a7717c3527ec95))
* document manual card resource for YAML-mode Lovelace ([#125](https://github.com/chrreiter/HAventory/issues/125)) ([a16e9f7](https://github.com/chrreiter/HAventory/commit/a16e9f7ee60f7257722bbf7a4d38f8d59cc3ceeb))
* document service error surfacing and WS cleanup ([e936ccb](https://github.com/chrreiter/HAventory/commit/e936ccbad5115ade4ffaf2c85f05beda4835304a))
* fix data_shapes.md type errors and missing fields ([ef7592d](https://github.com/chrreiter/HAventory/commit/ef7592db0972af9800dd781bc279b2daa4d0b424))
* fix doc drift (inspection_date, import dialog, locations subscription) ([#102](https://github.com/chrreiter/HAventory/issues/102)) ([8d512e5](https://github.com/chrreiter/HAventory/commit/8d512e508aad683d9eb929a0f2389718f9eaec2e))
* note browser refresh required after first card installation ([db6069c](https://github.com/chrreiter/HAventory/commit/db6069c2537427e6cf8f736b167f8e76c87624fb))
* note browser refresh required after first card installation ([ae5d694](https://github.com/chrreiter/HAventory/commit/ae5d6942aac71f97f51b0509ce280969e282d32d))
* **open-items:** track item/list unknown-filter-key leniency ([#24](https://github.com/chrreiter/HAventory/issues/24)) ([#101](https://github.com/chrreiter/HAventory/issues/101)) ([a22dbd1](https://github.com/chrreiter/HAventory/commit/a22dbd1521654dfeffc653af38a49de035ee0da9))
* **open-items:** track WP4 stress-test follow-ups (persistence, input hardening) ([#95](https://github.com/chrreiter/HAventory/issues/95)) ([4ac7b9d](https://github.com/chrreiter/HAventory/commit/4ac7b9dcc97c27746fe41cb712d83318c2f8ba42))
* plan the card shipping rework (integration-served bundle, zip_release) ([#146](https://github.com/chrreiter/HAventory/issues/146)) ([7ba749d](https://github.com/chrreiter/HAventory/commit/7ba749d856127e360651c91ecbdbd19525f50a62))
* publish a Known limitations section in the README ([#129](https://github.com/chrreiter/HAventory/issues/129)) ([a0ca70d](https://github.com/chrreiter/HAventory/commit/a0ca70dd8e212264e1e9f52e4478a975fbf306bb))
* **README:** document smoke_online.ps1 usage with env gating and invocation ([621ff60](https://github.com/chrreiter/HAventory/commit/621ff600e412cb1f1f3a56227629e043c8b52e08))
* reconcile open-items against 2026-07-27 fix batch ([#131](https://github.com/chrreiter/HAventory/issues/131)) ([406e031](https://github.com/chrreiter/HAventory/commit/406e031a49fce602e274d921d31a629ee53ae65c))
* record the live evidence for open item 32 and its release-gate collision ([#115](https://github.com/chrreiter/HAventory/issues/115)) ([5055232](https://github.com/chrreiter/HAventory/commit/50552323dfc2b89ea4e6c4ef5f778fc2c0a6bae8))
* **skill:** record Git Bash path conversion as a gotcha ([#117](https://github.com/chrreiter/HAventory/issues/117)) ([58531d8](https://github.com/chrreiter/HAventory/commit/58531d82abd3581a398b4d3a90f394b3429d1516))
* state that import matches entities by id, never by name ([#127](https://github.com/chrreiter/HAventory/issues/127)) ([7d359ec](https://github.com/chrreiter/HAventory/commit/7d359ec5719207d49ebe0fa240898b71fbcf4bb5))
* track four open items found during live release testing ([#118](https://github.com/chrreiter/HAventory/issues/118)) ([f671b63](https://github.com/chrreiter/HAventory/commit/f671b63717e2ab66a4a1396968c4e12554597c31))
* truth up the README's rate-limiting and calendar-entity claims ([#137](https://github.com/chrreiter/HAventory/issues/137)) ([8f3ee69](https://github.com/chrreiter/HAventory/commit/8f3ee69393a1685bf8cb5e7e27de83bb316f9a54))
* update WS cleanup description (close callbacks only) ([48010b2](https://github.com/chrreiter/HAventory/commit/48010b29ca491d83e8d961dc0fbce8133e4f4fca))


### Tests

* **storage:** add offline test ensuring migration failure returns empty and does not overwrite original payload ([ac3a415](https://github.com/chrreiter/HAventory/commit/ac3a4157979cac75e3c3f7631458edb89e917d81))
