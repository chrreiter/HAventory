# Changelog

## [0.9.2](https://github.com/chrreiter/HAventory/compare/v0.9.1...v0.9.2) (2026-09-03)


### Bug Fixes

* **card:** draw the category and tag merge targets in the card's own DOM ([#722](https://github.com/chrreiter/HAventory/issues/722)) ([196bcab](https://github.com/chrreiter/HAventory/commit/196bcab9422b570b6d6d8285a033c463e2c6becd))
* **card:** return the phone sheet to its read view when a save lands ([#721](https://github.com/chrreiter/HAventory/issues/721)) ([1a6ede2](https://github.com/chrreiter/HAventory/commit/1a6ede2d5175ef279b9a4703c84308171f70dd1a)), closes [#718](https://github.com/chrreiter/HAventory/issues/718)

## [0.9.1](https://github.com/chrreiter/HAventory/compare/v0.9.0...v0.9.1) (2026-09-03)


### Bug Fixes

* **card:** dispose the store when the card or panel leaves the page ([#716](https://github.com/chrreiter/HAventory/issues/716)) ([4864629](https://github.com/chrreiter/HAventory/commit/48646295130589b72b4788ec759fc16c08587ddf)), closes [#715](https://github.com/chrreiter/HAventory/issues/715)
* **media:** keep every attachment file when the store holds no items ([#713](https://github.com/chrreiter/HAventory/issues/713)) ([066c7be](https://github.com/chrreiter/HAventory/commit/066c7bed13c8ef1fb5a5d2ea16305392cfaf44a3))


### Documentation

* the V0.9.0 plan shipped; the validation run's results log ([#717](https://github.com/chrreiter/HAventory/issues/717)) ([79b8d1d](https://github.com/chrreiter/HAventory/commit/79b8d1d083cf69e2c7af567817997047fb7b4e0b))

## [0.9.0](https://github.com/chrreiter/HAventory/compare/v0.8.1...v0.9.0) (2026-09-02)


### Features

* **card:** a Take photo tile beside the photo picker on phones ([#705](https://github.com/chrreiter/HAventory/issues/705)) ([46209a3](https://github.com/chrreiter/HAventory/commit/46209a3924a3c9d51e9c34c38bfd5fc6ad800c95))
* **storage:** delete the schema-collapse adopter and the import-side exception ([#690](https://github.com/chrreiter/HAventory/issues/690)) ([54fe49d](https://github.com/chrreiter/HAventory/commit/54fe49d8fe4e6368ad70a2b3eed09d2af802fde2)), closes [#668](https://github.com/chrreiter/HAventory/issues/668)


### Bug Fixes

* **card:** every detail-sheet fact renders, location first ([#698](https://github.com/chrreiter/HAventory/issues/698)) ([a0313b7](https://github.com/chrreiter/HAventory/commit/a0313b79118b5ceb2866d0147c7cba8d56a90dc3)), closes [#697](https://github.com/chrreiter/HAventory/issues/697)
* **devcontainer:** a Home Assistant that survives a first run, a restart and default_config ([#707](https://github.com/chrreiter/HAventory/issues/707)) ([ef5b554](https://github.com/chrreiter/HAventory/commit/ef5b554bf46a8744f48a33be45f5db9b1b5ab402))
* tie requirements-dev.txt to uv.lock, not to independent pins ([#711](https://github.com/chrreiter/HAventory/issues/711)) ([491d8e5](https://github.com/chrreiter/HAventory/commit/491d8e5b99728a6f062031ee1ace5f7666196bc3))


### Documentation

* **card:** comments state the rule; specs state the behaviour ([#696](https://github.com/chrreiter/HAventory/issues/696)) ([115c851](https://github.com/chrreiter/HAventory/commit/115c8511c461e1b687d015bd5e12047e22755a81)), closes [#686](https://github.com/chrreiter/HAventory/issues/686)
* plain-language pass over every markdown file ([#710](https://github.com/chrreiter/HAventory/issues/710)) ([1b69f1f](https://github.com/chrreiter/HAventory/commit/1b69f1f3498c006c607fe35c798ff25fd71d30f4))
* the plan tests what ships ([#701](https://github.com/chrreiter/HAventory/issues/701)) ([a02a46a](https://github.com/chrreiter/HAventory/commit/a02a46a5eb56323323a60c7b2ce83021d332fa35))
* the V0.9.0 session plan and its implementer agent ([#688](https://github.com/chrreiter/HAventory/issues/688)) ([37d2120](https://github.com/chrreiter/HAventory/commit/37d212093824b05b299aae91664299a2419fe20d))
* what the tree says, said once ([#702](https://github.com/chrreiter/HAventory/issues/702)) ([1a474eb](https://github.com/chrreiter/HAventory/commit/1a474ebf44ee4179b8ded7264ad1d16465091ade)), closes [#687](https://github.com/chrreiter/HAventory/issues/687)

## [0.8.1](https://github.com/chrreiter/HAventory/compare/v0.8.0...v0.8.1) (2026-08-31)


### Bug Fixes

* **card:** show every editor field on a phone and add a clear button for the inspection date ([#682](https://github.com/chrreiter/HAventory/issues/682)) ([d7dd726](https://github.com/chrreiter/HAventory/commit/d7dd7266d46b558f7191460ba2990e73a70fa90d))

## [0.8.0](https://github.com/chrreiter/HAventory/compare/v0.7.1...v0.8.0) (2026-08-31)


### Features

* **card:** the built-in statuses in the reader's language ([#648](https://github.com/chrreiter/HAventory/issues/648)) ([94025f4](https://github.com/chrreiter/HAventory/commit/94025f48e1960a63257eed4cb100a9f5d9149c96))
* **card:** the filter panel shows the most-used tags and categories first ([#677](https://github.com/chrreiter/HAventory/issues/677)) ([a937439](https://github.com/chrreiter/HAventory/commit/a937439f80ed9299f79918a5da75c8b280315608)), closes [#660](https://github.com/chrreiter/HAventory/issues/660)
* **storage:** collapse the schema to v1 with a one-release adopter ([#669](https://github.com/chrreiter/HAventory/issues/669)) ([24f89e3](https://github.com/chrreiter/HAventory/commit/24f89e311b770a57c657b67e40b843be69c0c165))


### Bug Fixes

* **card:** accessible names and the conflict banner through the catalog ([#647](https://github.com/chrreiter/HAventory/issues/647)) ([1e2ae93](https://github.com/chrreiter/HAventory/commit/1e2ae93f98ac9141658c8044dd89705b0bd2360e))
* **card:** cancelling a value delete no longer drops keyboard focus to body ([#680](https://github.com/chrreiter/HAventory/issues/680)) ([883985d](https://github.com/chrreiter/HAventory/commit/883985d079dec8441cd89a92e2e2a589c47a9bdf)), closes [#678](https://github.com/chrreiter/HAventory/issues/678)
* **card:** cancelling a value-tab delete confirmation keeps Organize open ([#675](https://github.com/chrreiter/HAventory/issues/675)) ([8f30511](https://github.com/chrreiter/HAventory/commit/8f3051198cc2e9b61b068e3c7aa2cdf42bfe26ef)), closes [#661](https://github.com/chrreiter/HAventory/issues/661)
* **card:** the item editor saves only the fields the edit changed ([#662](https://github.com/chrreiter/HAventory/issues/662)) ([1c51b6f](https://github.com/chrreiter/HAventory/commit/1c51b6fdca9cab532a2395ef5caf0bab11301a06)), closes [#659](https://github.com/chrreiter/HAventory/issues/659)
* **card:** the tree row's actions join the tab order; the count leaves it ([#676](https://github.com/chrreiter/HAventory/issues/676)) ([1fe93aa](https://github.com/chrreiter/HAventory/commit/1fe93aac537c73d2d79adf5a639a34b4882f8411)), closes [#663](https://github.com/chrreiter/HAventory/issues/663)
* **i18n:** the German wording corrections ([#671](https://github.com/chrreiter/HAventory/issues/671)) ([b4c61c9](https://github.com/chrreiter/HAventory/commit/b4c61c9b38625d75fd8166cda35d1093981170e9))
* **media:** remove an item's attachment directory once its last file is gone ([#630](https://github.com/chrreiter/HAventory/issues/630)) ([4a22bf4](https://github.com/chrreiter/HAventory/commit/4a22bf41613600e11f8c1ab82275f1e0abf85417)), closes [#333](https://github.com/chrreiter/HAventory/issues/333)
* **models:** a degenerate area filter is refused, never ignored ([#673](https://github.com/chrreiter/HAventory/issues/673)) ([7c1a5ac](https://github.com/chrreiter/HAventory/commit/7c1a5ac7afaa6c22157a6bd1ccabe9ea290cb80f)), closes [#649](https://github.com/chrreiter/HAventory/issues/649)
* **models:** a filter's tags_any and tags_all are lists of strings ([f1f6d9b](https://github.com/chrreiter/HAventory/commit/f1f6d9b328675864f5c11ee08de4d047b04a6fd8))
* **repository:** search finds a mid-word match even when another item's word starts with the query ([#623](https://github.com/chrreiter/HAventory/issues/623)) ([ef0924c](https://github.com/chrreiter/HAventory/commit/ef0924cb182b75576b74bf4fbac9df0c4da0fb51))
* **services:** an item_update carrying a location announces the move ([53725d6](https://github.com/chrreiter/HAventory/commit/53725d628a07a642e8d0f806fe7415df3b15d2d2))
* **services:** one selector per field, and an example on every one ([53725d6](https://github.com/chrreiter/HAventory/commit/53725d628a07a642e8d0f806fe7415df3b15d2d2))
* **ws:** a bulk delete frees the item's attachment files at once ([06592f5](https://github.com/chrreiter/HAventory/commit/06592f5e679800f61be9f9a1d440a343061cac3d))
* **ws:** answer a refused quantity the same way from the command and from a bulk row ([06592f5](https://github.com/chrreiter/HAventory/commit/06592f5e679800f61be9f9a1d440a343061cac3d))
* **ws:** haventory/subscribe refuses a location id that is not a string ([f1f6d9b](https://github.com/chrreiter/HAventory/commit/f1f6d9b328675864f5c11ee08de4d047b04a6fd8))


### Documentation

* add the V0.8.0 session plan ([#570](https://github.com/chrreiter/HAventory/issues/570)) ([324f1dc](https://github.com/chrreiter/HAventory/commit/324f1dca3df4ed9557d7234e7a5415f2d86ee638))
* **card:** comments that state the rule, not the measurement ([#634](https://github.com/chrreiter/HAventory/issues/634)) ([5469995](https://github.com/chrreiter/HAventory/commit/5469995507fd2735ce3f867adc11506191b200b9))
* correct outdated claims and simplify wording in user-facing docs ([#681](https://github.com/chrreiter/HAventory/issues/681)) ([61f536d](https://github.com/chrreiter/HAventory/commit/61f536d245b98fe0c36d98f27fa5368c7177b73e))
* one home per fact; scripts nothing calls ([#667](https://github.com/chrreiter/HAventory/issues/667)) ([2aaf7a3](https://github.com/chrreiter/HAventory/commit/2aaf7a31dce30dca05575149a7dbf3a35d0bbc13))
* **readme:** the Release badge counts pre-releases ([#672](https://github.com/chrreiter/HAventory/issues/672)) ([fdc4c66](https://github.com/chrreiter/HAventory/commit/fdc4c66cd602f458c109325049b7082555ce8c30))
* the status vocabulary is the household's; triggers are `trigger:` ([#666](https://github.com/chrreiter/HAventory/issues/666)) ([815986d](https://github.com/chrreiter/HAventory/commit/815986d64e539c217aa66d3f5c29018f34d66600))
* the V0.8.0 plan shipped; delete the plan and its implementer agent ([#679](https://github.com/chrreiter/HAventory/issues/679)) ([9b1d1d5](https://github.com/chrreiter/HAventory/commit/9b1d1d5cb18220baab5dd6eda1ba88ca3293eb1b))

## [0.7.1](https://github.com/chrreiter/HAventory/compare/v0.7.0...v0.7.1) (2026-08-23)


### Bug Fixes

* **backend:** log a healthy empty store at DEBUG, not WARNING ([#601](https://github.com/chrreiter/HAventory/issues/601)) ([7e41760](https://github.com/chrreiter/HAventory/commit/7e417605e2c9522cc2b21576bee414a57363b905))
* **card:** drop the phone row's area pill whole instead of slicing it ([#614](https://github.com/chrreiter/HAventory/issues/614)) ([135b96a](https://github.com/chrreiter/HAventory/commit/135b96a617918a44d8afeb6a2ba2bf42a0efe403)), closes [#608](https://github.com/chrreiter/HAventory/issues/608)
* **card:** give a picture whose file is gone the missing state ([#606](https://github.com/chrreiter/HAventory/issues/606)) ([5e73841](https://github.com/chrreiter/HAventory/commit/5e738415bd32eee7f894e5a3df10a51b352f2b88))
* **card:** hold the panel heading whole and clear the app bar's dead spacers ([#611](https://github.com/chrreiter/HAventory/issues/611)) ([e9704e4](https://github.com/chrreiter/HAventory/commit/e9704e476d23b1b035ee182593e0ba269fa34b48))
* **card:** keep a phone-width panel row one line high whatever the path's depth ([#604](https://github.com/chrreiter/HAventory/issues/604)) ([a84bb41](https://github.com/chrreiter/HAventory/commit/a84bb417c038316d0c8bf10d86c3e6adba1f6b06))
* **card:** keep the panel's app bar on one row down to the narrow layout ([#605](https://github.com/chrreiter/HAventory/issues/605)) ([95e79d7](https://github.com/chrreiter/HAventory/commit/95e79d72ba551e7a33b1ddc8aa22e6c0979ceef5))
* **card:** show the import preview's missing-attachment caveat ([#602](https://github.com/chrreiter/HAventory/issues/602)) ([e392dd4](https://github.com/chrreiter/HAventory/commit/e392dd4dcf6105ecf2d65a11536a38ab25b7dff7)), closes [#597](https://github.com/chrreiter/HAventory/issues/597)
* **media:** keep a picture's transparency in its row tile ([#603](https://github.com/chrreiter/HAventory/issues/603)) ([fef5b09](https://github.com/chrreiter/HAventory/commit/fef5b09d93ec1659ce6a92bc0e4f49dd6716fb6b))
* **media:** name a row tile for the encoder generation that wrote it ([#612](https://github.com/chrreiter/HAventory/issues/612)) ([ed2a667](https://github.com/chrreiter/HAventory/commit/ed2a6674fd0b21ecfda3ec155a9f83f17f417695)), closes [#609](https://github.com/chrreiter/HAventory/issues/609)

## [0.7.0](https://github.com/chrreiter/HAventory/compare/v0.6.0...v0.7.0) (2026-08-23)


### Features

* **brand:** ship icons and logos inside the integration ([#502](https://github.com/chrreiter/HAventory/issues/502)) ([f84d04b](https://github.com/chrreiter/HAventory/commit/f84d04b9181c7b833c952fa23002ba958832eeb0))
* **card:** make an item's and a location's id readable and copyable ([#580](https://github.com/chrreiter/HAventory/issues/580)) ([06c9b0d](https://github.com/chrreiter/HAventory/commit/06c9b0d14a675a9f1233cbbe14c9c939dd9e0978))
* **card:** show the row thumbnail in the full view and the sidebar panel ([#534](https://github.com/chrreiter/HAventory/issues/534)) ([456b6dc](https://github.com/chrreiter/HAventory/commit/456b6dca0960bc811f2f9a11e9dc98114146ece6)), closes [#490](https://github.com/chrreiter/HAventory/issues/490)
* **counts:** a checked-out due count, and an inspection pill that means due ([#511](https://github.com/chrreiter/HAventory/issues/511)) ([713f37e](https://github.com/chrreiter/HAventory/commit/713f37e367a5e0ea35b33a14d756e605e07ff3d1))
* **i18n:** translate the card components (1/2) ([#538](https://github.com/chrreiter/HAventory/issues/538)) ([7844c0d](https://github.com/chrreiter/HAventory/commit/7844c0df98fb9001328c2c06c73bf7c122520015)), closes [#190](https://github.com/chrreiter/HAventory/issues/190)
* **i18n:** translate the card components (2/2) ([#539](https://github.com/chrreiter/HAventory/issues/539)) ([f1461df](https://github.com/chrreiter/HAventory/commit/f1461df756da304563dca6aadc4af22a23cdfbd2)), closes [#190](https://github.com/chrreiter/HAventory/issues/190)
* **i18n:** translation mechanism, German backend translations and the shared copy modules ([#537](https://github.com/chrreiter/HAventory/issues/537)) ([e4a75af](https://github.com/chrreiter/HAventory/commit/e4a75af627de6ca2b69ab3240a91f7aa9bca2bed)), closes [#190](https://github.com/chrreiter/HAventory/issues/190)
* **sensor:** checked-out, locations and inspection-due counts ([#504](https://github.com/chrreiter/HAventory/issues/504)) ([5c22c83](https://github.com/chrreiter/HAventory/commit/5c22c83b59a7dfd431bbef148e48fa3e43d56e9d)), closes [#493](https://github.com/chrreiter/HAventory/issues/493)
* **sensor:** name the four counts so an automation reads unambiguously ([#492](https://github.com/chrreiter/HAventory/issues/492)) ([aba8f8b](https://github.com/chrreiter/HAventory/commit/aba8f8b41f75df7212b1e28dee8732f1faeae65f))
* **services:** give every service field a name and a description ([#593](https://github.com/chrreiter/HAventory/issues/593)) ([c7c469a](https://github.com/chrreiter/HAventory/commit/c7c469a6de61f0690910dd1fc2018f30240c9f75))


### Bug Fixes

* **backend:** measure every date against the instance's own day ([#579](https://github.com/chrreiter/HAventory/issues/579)) ([9e269db](https://github.com/chrreiter/HAventory/commit/9e269dbdb2d4060694d49cdea1adbe102ffc16ac))
* **calendar:** write event summaries in the server language ([#572](https://github.com/chrreiter/HAventory/issues/572)) ([198b05e](https://github.com/chrreiter/HAventory/commit/198b05e7324022035d3f7c1ed004a4fe8064b1e4)), closes [#562](https://github.com/chrreiter/HAventory/issues/562)
* **card:** cap the filter panel's label chips behind More… ([#585](https://github.com/chrreiter/HAventory/issues/585)) ([f281cd2](https://github.com/chrreiter/HAventory/commit/f281cd2ea6b319e3d766c2fa9b5f97892e97b32d))
* **card:** give each sidebar facet list one tab stop and an arrow layer ([#578](https://github.com/chrreiter/HAventory/issues/578)) ([6fe7d8e](https://github.com/chrreiter/HAventory/commit/6fe7d8e334f8567edc3015875fb33569d0019729)), closes [#574](https://github.com/chrreiter/HAventory/issues/574)
* **card:** give the locations tree one tab stop and an arrow layer ([#575](https://github.com/chrreiter/HAventory/issues/575)) ([31dd109](https://github.com/chrreiter/HAventory/commit/31dd1099a92daeca8105f19fcbb0e4721a21f40d)), closes [#559](https://github.com/chrreiter/HAventory/issues/559)
* **card:** keep the detail sheet's action pair on one line in German ([#586](https://github.com/chrreiter/HAventory/issues/586)) ([5c99551](https://github.com/chrreiter/HAventory/commit/5c9955122b0a7039e2047e39099fa62dad41f3db))
* **card:** keep the filtered total honest when an event inserts a row ([#554](https://github.com/chrreiter/HAventory/issues/554)) ([b878bfe](https://github.com/chrreiter/HAventory/commit/b878bfe837d005e5fd3d2bbabc061478daa209e5)), closes [#505](https://github.com/chrreiter/HAventory/issues/505)
* **card:** keep the full view's phone-width bars whole in German ([#561](https://github.com/chrreiter/HAventory/issues/561)) ([34297f9](https://github.com/chrreiter/HAventory/commit/34297f90e9aeb0e79afdd01e5801d8ee05c6bb91))
* **card:** keep the location tree's tally whole when an area name is long ([#533](https://github.com/chrreiter/HAventory/issues/533)) ([730e52f](https://github.com/chrreiter/HAventory/commit/730e52fdfd5f6426f07833e72d28881c164e6f55)), closes [#426](https://github.com/chrreiter/HAventory/issues/426)
* **card:** keep the panel's phone filter footer and toolbar one row each ([#587](https://github.com/chrreiter/HAventory/issues/587)) ([8d60d80](https://github.com/chrreiter/HAventory/commit/8d60d8061067622c00d836ca351f8cbd44cb4e89)), closes [#582](https://github.com/chrreiter/HAventory/issues/582)
* **card:** keep the phone editor's action row on one line in German ([#573](https://github.com/chrreiter/HAventory/issues/573)) ([583ea1d](https://github.com/chrreiter/HAventory/commit/583ea1de9529ad8bd4e15ea3b4f14908773e6735)), closes [#560](https://github.com/chrreiter/HAventory/issues/560)
* **card:** one tone for a date that has passed ([#553](https://github.com/chrreiter/HAventory/issues/553)) ([ce28c86](https://github.com/chrreiter/HAventory/commit/ce28c86560846968fc4815120330aec6eec37036)), closes [#498](https://github.com/chrreiter/HAventory/issues/498)
* **card:** say Overdue on the table row, not Checked out ([#552](https://github.com/chrreiter/HAventory/issues/552)) ([6a92614](https://github.com/chrreiter/HAventory/commit/6a92614e2cf1b3b2e597aca0e100f1b9d4b199c7)), closes [#499](https://github.com/chrreiter/HAventory/issues/499)
* free an item's attachment files on every delete surface ([#592](https://github.com/chrreiter/HAventory/issues/592)) ([52fae71](https://github.com/chrreiter/HAventory/commit/52fae71c61d748b7335b13d65fd8a8433032ff10))
* **logging:** put the context a bug report needs into the message text ([#510](https://github.com/chrreiter/HAventory/issues/510)) ([44ad859](https://github.com/chrreiter/HAventory/commit/44ad859bdb9f987d8f516fb3f7ccdde05ab2b073)), closes [#430](https://github.com/chrreiter/HAventory/issues/430)
* name the date field that was refused ([#590](https://github.com/chrreiter/HAventory/issues/590)) ([e286b48](https://github.com/chrreiter/HAventory/commit/e286b489e5eb03d3969c2cf37ce61f06b536dc42)), closes [#566](https://github.com/chrreiter/HAventory/issues/566)
* **panel:** keep an open `/haventory` page across a reload ([#550](https://github.com/chrreiter/HAventory/issues/550)) ([20e484b](https://github.com/chrreiter/HAventory/commit/20e484b12a0f19221371dce1534f508df5601c30)), closes [#507](https://github.com/chrreiter/HAventory/issues/507)
* refuse a tags value that is not a list of strings ([#591](https://github.com/chrreiter/HAventory/issues/591)) ([2517a9b](https://github.com/chrreiter/HAventory/commit/2517a9be98d82086d03fc477728d400125711924)), closes [#567](https://github.com/chrreiter/HAventory/issues/567)
* roll the counts and the card over at the instance's midnight ([#588](https://github.com/chrreiter/HAventory/issues/588)) ([c322683](https://github.com/chrreiter/HAventory/commit/c3226833d431959ec6c584fcd35455b2a804e3f1))
* **services:** broadcast service mutations to WebSocket subscribers ([#506](https://github.com/chrreiter/HAventory/issues/506)) ([10115fc](https://github.com/chrreiter/HAventory/commit/10115fcd0195d3ee4fe05824fc632e32b1c02b36)), closes [#450](https://github.com/chrreiter/HAventory/issues/450)
* **skills:** give the restart layer a budget that outlasts a post-kill boot ([#557](https://github.com/chrreiter/HAventory/issues/557)) ([ed44f2e](https://github.com/chrreiter/HAventory/commit/ed44f2e1c5bb063b71aa89f8417d5544635cc17b))
* **skills:** make stress.py honour the worktree's .env and name its target ([#524](https://github.com/chrreiter/HAventory/issues/524)) ([0a6e902](https://github.com/chrreiter/HAventory/commit/0a6e902e9ec5652097cb400e22e9ad3bfe70211b)), closes [#432](https://github.com/chrreiter/HAventory/issues/432)
* **skills:** submit the 0.7.0 options form whole, and only put the rate-limit knobs in their own section ([#556](https://github.com/chrreiter/HAventory/issues/556)) ([874758c](https://github.com/chrreiter/HAventory/commit/874758c33e0229a32c843f9b6b4b6c82f813c217))
* **storage:** count a stored row with no name as unreadable ([#501](https://github.com/chrreiter/HAventory/issues/501)) ([9d54bb3](https://github.com/chrreiter/HAventory/commit/9d54bb329c0a652b4baa3e606da8a6db5cb7323c)), closes [#466](https://github.com/chrreiter/HAventory/issues/466)
* **todo:** stop logging an ERROR for a start listener that has already fired ([#551](https://github.com/chrreiter/HAventory/issues/551)) ([3c1a2be](https://github.com/chrreiter/HAventory/commit/3c1a2be0a7a724ca3fae5a2f6d01dcf87ec559c4)), closes [#508](https://github.com/chrreiter/HAventory/issues/508)


### Performance Improvements

* **media:** serve row thumbnails instead of the stored picture ([#576](https://github.com/chrreiter/HAventory/issues/576)) ([268fc02](https://github.com/chrreiter/HAventory/commit/268fc02fdbea0b2b808c90c6d6ce40ed3b741986)), closes [#563](https://github.com/chrreiter/HAventory/issues/563)


### Documentation

* add [#493](https://github.com/chrreiter/HAventory/issues/493) (three more sensors) to S2 and run every session on Opus 5 ([#494](https://github.com/chrreiter/HAventory/issues/494)) ([af8a68d](https://github.com/chrreiter/HAventory/commit/af8a68d87752f40150c845acaea29c28aea7cacc))
* add the V0.7.0 fixup session plan ([#571](https://github.com/chrreiter/HAventory/issues/571)) ([6b260cf](https://github.com/chrreiter/HAventory/commit/6b260cf4df4781e606f1e7045138d835402af560))
* add the V0.7.0 session plan and retire the V0.6.0 one ([#489](https://github.com/chrreiter/HAventory/issues/489)) ([1b7d854](https://github.com/chrreiter/HAventory/commit/1b7d854bf1135081e97e96b01ebcab2d4771466a))
* **brand:** say what HAventory does now on its social preview ([#503](https://github.com/chrreiter/HAventory/issues/503)) ([c0e8b77](https://github.com/chrreiter/HAventory/commit/c0e8b7717cd9ad46b139722fbf3bc5f44ea1c520))
* one declared floor, and a guard against a second README version ([#513](https://github.com/chrreiter/HAventory/issues/513)) ([16aad36](https://github.com/chrreiter/HAventory/commit/16aad36fa75e5ff622a765e2b09cef2a0e367a0b)), closes [#235](https://github.com/chrreiter/HAventory/issues/235)
* plan the V0.7.0 items filed after the plan, and keep the Fable sweep last ([#545](https://github.com/chrreiter/HAventory/issues/545)) ([6c3b4e8](https://github.com/chrreiter/HAventory/commit/6c3b4e87bf325c42742007fabc3c8aa0f76f0e0b))
* purge development residue and trim CLAUDE.md ([#543](https://github.com/chrreiter/HAventory/issues/543)) ([068af8f](https://github.com/chrreiter/HAventory/commit/068af8f2bdaba48ca62f0e115603b34115f2ee03)), closes [#216](https://github.com/chrreiter/HAventory/issues/216)
* state the invalid_format / validation_error split as a rule; count the sortable fields right ([#541](https://github.com/chrreiter/HAventory/issues/541)) ([3e8c79f](https://github.com/chrreiter/HAventory/commit/3e8c79f178a05fd4d4113676bbb2588ab25fe1c6)), closes [#441](https://github.com/chrreiter/HAventory/issues/441)
* user-first README with screenshots ([#547](https://github.com/chrreiter/HAventory/issues/547)) ([f4e1b74](https://github.com/chrreiter/HAventory/commit/f4e1b74294be361cfcc9b3f27cd31ce6ef75ae18))

## [0.6.0](https://github.com/chrreiter/HAventory/compare/v0.5.0...v0.6.0) (2026-08-15)


### Features

* **calendar:** project due and inspection dates ([#452](https://github.com/chrreiter/HAventory/issues/452)) ([cd5a35a](https://github.com/chrreiter/HAventory/commit/cd5a35a00ebeb580a8a746ce7e1c4bf4b7270923))
* **diagnostics:** entry diagnostics, repairs issues and a guarded lossy load ([#454](https://github.com/chrreiter/HAventory/issues/454)) ([71e494c](https://github.com/chrreiter/HAventory/commit/71e494c77861f928834bafe776174f559a4f1304)), closes [#225](https://github.com/chrreiter/HAventory/issues/225)
* **reminders:** read a reminder in the card, and mark one done ([#487](https://github.com/chrreiter/HAventory/issues/487)) ([2235d39](https://github.com/chrreiter/HAventory/commit/2235d39fd0fdd7e7f30bc3a3dbef5b6dcfcecea0)), closes [#478](https://github.com/chrreiter/HAventory/issues/478)
* **reminders:** recurring reminders on items ([#453](https://github.com/chrreiter/HAventory/issues/453)) ([986b0bf](https://github.com/chrreiter/HAventory/commit/986b0bfa0892fbfa54b8c33b173545b40459ddab))
* **reminders:** store the series anchor so a bump keeps its day of month ([#476](https://github.com/chrreiter/HAventory/issues/476)) ([1056d88](https://github.com/chrreiter/HAventory/commit/1056d88c710e7341aa384cfa1fc7db8afe9a7b14)), closes [#460](https://github.com/chrreiter/HAventory/issues/460)
* **sensor:** four inventory sensors and bus events for automations ([#449](https://github.com/chrreiter/HAventory/issues/449)) ([e17bc64](https://github.com/chrreiter/HAventory/commit/e17bc64b805461f966ed721348eced7346a8a1e3))
* **services:** return response data from every service ([#448](https://github.com/chrreiter/HAventory/issues/448)) ([684e591](https://github.com/chrreiter/HAventory/commit/684e591a1723927a799e2a0d681a2756299242aa)), closes [#219](https://github.com/chrreiter/HAventory/issues/219)
* **services:** set, clear and bump reminders from an automation ([#473](https://github.com/chrreiter/HAventory/issues/473)) ([897ff1e](https://github.com/chrreiter/HAventory/commit/897ff1eaac3ede8f012c21976f5be3602ade32cf)), closes [#464](https://github.com/chrreiter/HAventory/issues/464) [#467](https://github.com/chrreiter/HAventory/issues/467)
* **todo:** mirror low-stock items onto a chosen to-do list ([#451](https://github.com/chrreiter/HAventory/issues/451)) ([c89ee82](https://github.com/chrreiter/HAventory/commit/c89ee82099873b1f98a9aed58d86fc06b09dd972)), closes [#232](https://github.com/chrreiter/HAventory/issues/232)


### Bug Fixes

* **diagnostics:** keep the household's own vocabulary out of the download ([#475](https://github.com/chrreiter/HAventory/issues/475)) ([c3916f6](https://github.com/chrreiter/HAventory/commit/c3916f672a0f9f2d7c002d7774ce46003b2088e2)), closes [#465](https://github.com/chrreiter/HAventory/issues/465)
* **events:** announce a status reassignment and repaint after a location rename ([#471](https://github.com/chrreiter/HAventory/issues/471)) ([31b897f](https://github.com/chrreiter/HAventory/commit/31b897fe9b9c4a4841a47741dce2d97c96fe09f5)), closes [#462](https://github.com/chrreiter/HAventory/issues/462) [#463](https://github.com/chrreiter/HAventory/issues/463)
* **import:** validate reminder and inspection dates, and keep the calendar up on one it cannot read ([#470](https://github.com/chrreiter/HAventory/issues/470)) ([4f3d26c](https://github.com/chrreiter/HAventory/commit/4f3d26cfe0269bb0a5ae098c9f44b9f088a26daa)), closes [#458](https://github.com/chrreiter/HAventory/issues/458)
* **reminders:** count a bump from the local day the calendar runs on ([#472](https://github.com/chrreiter/HAventory/issues/472)) ([f4a3a48](https://github.com/chrreiter/HAventory/commit/f4a3a48256129a1f6c51dba5cc88628c1ba7665a)), closes [#461](https://github.com/chrreiter/HAventory/issues/461)
* **reminders:** stop an ordinary save re-anchoring a month-end series ([#484](https://github.com/chrreiter/HAventory/issues/484)) ([122f266](https://github.com/chrreiter/HAventory/commit/122f266ced6d60157673665820f428ac5db57efc)), closes [#477](https://github.com/chrreiter/HAventory/issues/477)
* resolve the five v0.5.0 review bugs staged for v0.6.0 ([#444](https://github.com/chrreiter/HAventory/issues/444)) ([1459cc6](https://github.com/chrreiter/HAventory/commit/1459cc68cd65b9a13e4921263022b21dea8bdd59))
* **scripts:** answer the config flow with the defaults its schema offers ([#446](https://github.com/chrreiter/HAventory/issues/446)) ([1787922](https://github.com/chrreiter/HAventory/commit/1787922efaa87340ca841fc15fc0ba7ed1990e99)), closes [#431](https://github.com/chrreiter/HAventory/issues/431)
* **storage:** spend the lossy-load opt-in on every load and make the repair stick ([#469](https://github.com/chrreiter/HAventory/issues/469)) ([86f49b0](https://github.com/chrreiter/HAventory/commit/86f49b027c63a6ff2d7f863c65f466e0121ff8b8))
* **todo:** stop a list that cannot delete collecting one orphan line per crossing ([#474](https://github.com/chrreiter/HAventory/issues/474)) ([62dfe27](https://github.com/chrreiter/HAventory/commit/62dfe27e58f1bccbf4d90d91cef4d58c66790d57)), closes [#459](https://github.com/chrreiter/HAventory/issues/459)


### Documentation

* **dev:** add the V0.6.0 concept and session plan ([#447](https://github.com/chrreiter/HAventory/issues/447)) ([7594b1a](https://github.com/chrreiter/HAventory/commit/7594b1a073e2fe57ad32e65cb310aa63a0509fb6))
* **dev:** record what the tree adds to S5's collapse brief ([#468](https://github.com/chrreiter/HAventory/issues/468)) ([bb9d474](https://github.com/chrreiter/HAventory/commit/bb9d474ecddea14c1a7ff642578a08091f8e20c8))
* fix two comments that no longer describe their code ([#483](https://github.com/chrreiter/HAventory/issues/483)) ([3ea1f86](https://github.com/chrreiter/HAventory/commit/3ea1f86017652729d1073ced88e5782ac1057d59)), closes [#481](https://github.com/chrreiter/HAventory/issues/481)
* make the known-limitations tracking sentence true ([#486](https://github.com/chrreiter/HAventory/issues/486)) ([ae0ccb4](https://github.com/chrreiter/HAventory/commit/ae0ccb4a472586c641e8ad9b094052db53092e18)), closes [#479](https://github.com/chrreiter/HAventory/issues/479)

## [0.5.0](https://github.com/chrreiter/HAventory/compare/v0.4.3...v0.5.0) (2026-08-13)


### Features

* **config:** offer the quick-filter pills in the options flow ([#416](https://github.com/chrreiter/HAventory/issues/416)) ([bf681bd](https://github.com/chrreiter/HAventory/commit/bf681bda901252df27663375b03d876c4d3056e5))
* **import:** warn when an incoming name collides with another id ([#417](https://github.com/chrreiter/HAventory/issues/417)) ([3efdad6](https://github.com/chrreiter/HAventory/commit/3efdad6f34bb49093a3e006e77615b92cef6152e))
* **status:** accept a hex colour beside the ten tokens ([#418](https://github.com/chrreiter/HAventory/issues/418)) ([31e9286](https://github.com/chrreiter/HAventory/commit/31e9286af05a2f0dfd46be05533be800277e715a))
* **ws:** filter subscriptions by area ([#414](https://github.com/chrreiter/HAventory/issues/414)) ([c698886](https://github.com/chrreiter/HAventory/commit/c698886885e4649ea4f8cb65a04af0d1bf8bf119)), closes [#194](https://github.com/chrreiter/HAventory/issues/194)
* **ws:** multi-select categories and locations in filters ([#423](https://github.com/chrreiter/HAventory/issues/423)) ([f4f0cfb](https://github.com/chrreiter/HAventory/commit/f4f0cfb8a2164e438e32ad28013e06a272cb065d))
* **ws:** order items by their location path ([#424](https://github.com/chrreiter/HAventory/issues/424)) ([e9ea8de](https://github.com/chrreiter/HAventory/commit/e9ea8de71f59c7f13a982edc99ea32df90248ed4))
* **ws:** price category and tag facets against the active filter ([#422](https://github.com/chrreiter/HAventory/issues/422)) ([d6c73ad](https://github.com/chrreiter/HAventory/commit/d6c73ad6c11a7e9cd96f040d57a5c07af012dad0))


### Bug Fixes

* **ci:** guard the Python floor's copies ([#409](https://github.com/chrreiter/HAventory/issues/409)) ([0b4a98b](https://github.com/chrreiter/HAventory/commit/0b4a98b193eeb3669952f7f58ff802aff2ba6d76)), closes [#356](https://github.com/chrreiter/HAventory/issues/356) [#355](https://github.com/chrreiter/HAventory/issues/355)
* **storage:** stamp hex status colours at a version older builds refuse ([#443](https://github.com/chrreiter/HAventory/issues/443)) ([76bb7cc](https://github.com/chrreiter/HAventory/commit/76bb7cca0468d8ec22c6b589aadc0fffb0851e76)), closes [#436](https://github.com/chrreiter/HAventory/issues/436)
* **ws:** bound and type the WebSocket inputs ([#415](https://github.com/chrreiter/HAventory/issues/415)) ([2a77eb2](https://github.com/chrreiter/HAventory/commit/2a77eb2bcb25b88b8b730f2f07a2bdb0c2bd68d6))
* **ws:** close out V0.5.0 — area events, import counts, filter parsing ([#434](https://github.com/chrreiter/HAventory/issues/434)) ([2435a49](https://github.com/chrreiter/HAventory/commit/2435a49da216bceddbe0fae9372e973cac5e6910))


### Performance Improvements

* **storage:** stop copying the whole dataset on every save ([#429](https://github.com/chrreiter/HAventory/issues/429)) ([dc611fa](https://github.com/chrreiter/HAventory/commit/dc611fa0fa996288f61dbf8c27e62231cd8f14ac))

## [0.4.3](https://github.com/chrreiter/HAventory/compare/v0.4.2...v0.4.3) (2026-08-11)


### Bug Fixes

* **card:** the area mark and the check-out popover's thumb sizes ([#411](https://github.com/chrreiter/HAventory/issues/411)) ([c99ceeb](https://github.com/chrreiter/HAventory/commit/c99ceebdcb04e526f4addf9de90cfed8401f9afc))
* **card:** the v0.4.3 residuals — the full view's row check-out popover and the sheet's path crumb ([#407](https://github.com/chrreiter/HAventory/issues/407)) ([5f5e926](https://github.com/chrreiter/HAventory/commit/5f5e926354d6a7751942649ac9bec6f07949a942)), closes [#403](https://github.com/chrreiter/HAventory/issues/403)


### Documentation

* **dev:** add the V0.5.0 implementation plan ([#404](https://github.com/chrreiter/HAventory/issues/404)) ([32ffa74](https://github.com/chrreiter/HAventory/commit/32ffa7445b09e4549e8c3aee87e484de18412a5a))

## [0.4.2](https://github.com/chrreiter/HAventory/compare/v0.4.1...v0.4.2) (2026-08-11)


### Bug Fixes

* **card:** the ⋮ menu is placed against the viewport, out of every scroller's clip ([#395](https://github.com/chrreiter/HAventory/issues/395)) ([f780127](https://github.com/chrreiter/HAventory/commit/f78012762bc91c0f9ab05ed104fa17e24f591975)), closes [#389](https://github.com/chrreiter/HAventory/issues/389)
* **card:** v0.4.2 table and overflow-menu residuals from the v0.4.1 pass ([#400](https://github.com/chrreiter/HAventory/issues/400)) ([1e382d9](https://github.com/chrreiter/HAventory/commit/1e382d9dde14f1d12bd18f24b8e01fa20d815259)), closes [#399](https://github.com/chrreiter/HAventory/issues/399)

## [0.4.1](https://github.com/chrreiter/HAventory/compare/v0.4.0...v0.4.1) (2026-08-11)


### Bug Fixes

* **card:** Home Assistant reads the card's picker statics off the class ([#374](https://github.com/chrreiter/HAventory/issues/374)) ([de3fca5](https://github.com/chrreiter/HAventory/commit/de3fca5fc5826422fa4f1d3ba5f8efdf712e931b)), closes [#222](https://github.com/chrreiter/HAventory/issues/222)
* **card:** line the editor's check-out box up with the field beside it ([#368](https://github.com/chrreiter/HAventory/issues/368)) ([72fbc51](https://github.com/chrreiter/HAventory/commit/72fbc5156ea9bb7c5104913a28b3d894ae9ff6bf)), closes [#359](https://github.com/chrreiter/HAventory/issues/359)
* **card:** mark the area on a phone row instead of spelling it as a path ([#373](https://github.com/chrreiter/HAventory/issues/373)) ([52855d1](https://github.com/chrreiter/HAventory/commit/52855d1371e2982ba022d21bfca760cb3cbc41f2)), closes [#203](https://github.com/chrreiter/HAventory/issues/203)
* **card:** one chip vocabulary — tags blue everywhere, tag chips at chip size ([#367](https://github.com/chrreiter/HAventory/issues/367)) ([2a2185f](https://github.com/chrreiter/HAventory/commit/2a2185ff424d576ed103cf4bf00585113d997b04))
* **card:** rows stop being sized by the parts that cannot shrink ([#372](https://github.com/chrreiter/HAventory/issues/372)) ([57a012a](https://github.com/chrreiter/HAventory/commit/57a012aed7070e04e49705e86d82b3b7c86a1d34))
* **card:** the detail sheet writes custom-field keys for reading ([#393](https://github.com/chrreiter/HAventory/issues/393)) ([63ff14a](https://github.com/chrreiter/HAventory/commit/63ff14afa0bf41c7c69a8edba5c0fd77bd7be6d2)), closes [#383](https://github.com/chrreiter/HAventory/issues/383)
* **card:** the expanded view stops taking the card's touch sizing; sidebar rows match ([#369](https://github.com/chrreiter/HAventory/issues/369)) ([05537fe](https://github.com/chrreiter/HAventory/commit/05537fe4bfbc19362703565424452d15f8bd0c14))
* **card:** the full view's table stops cutting Location and Tags mid-content ([#394](https://github.com/chrreiter/HAventory/issues/394)) ([c0b4a26](https://github.com/chrreiter/HAventory/commit/c0b4a26ba13eea7bbd38096e3f9df9d129b00cda)), closes [#378](https://github.com/chrreiter/HAventory/issues/378)
* **card:** v0.4.1 copy fixes across the card's surfaces ([#390](https://github.com/chrreiter/HAventory/issues/390)) ([a0eeba3](https://github.com/chrreiter/HAventory/commit/a0eeba3ffd27216e3fdec022b715542ecd6681c5)), closes [#382](https://github.com/chrreiter/HAventory/issues/382)
* **card:** v0.4.1 list-row fixes for areas and checked-out items ([#392](https://github.com/chrreiter/HAventory/issues/392)) ([df9edab](https://github.com/chrreiter/HAventory/commit/df9edab485a8ef29b522ffa3a241592ed97a3a41)), closes [#379](https://github.com/chrreiter/HAventory/issues/379)
* **card:** v0.4.1 state and mark fixes across the card's surfaces ([#391](https://github.com/chrreiter/HAventory/issues/391)) ([3a3e489](https://github.com/chrreiter/HAventory/commit/3a3e489691f56c152feeb4558faf473e91175631)), closes [#388](https://github.com/chrreiter/HAventory/issues/388)


### Documentation

* record buttons as the card's reordering idiom ([#371](https://github.com/chrreiter/HAventory/issues/371)) ([5b951db](https://github.com/chrreiter/HAventory/commit/5b951db428c90edfaa677a818c3d5176c77cb7d5))

## [0.4.0](https://github.com/chrreiter/HAventory/compare/v0.3.3...v0.4.0) (2026-08-10)


### Features

* **backend:** serve attachments with Content-Disposition; land attachment verification probes ([#312](https://github.com/chrreiter/HAventory/issues/312)) ([6146a36](https://github.com/chrreiter/HAventory/commit/6146a361e367a72afa9b75e17b5c634fc676074e))
* **card:** adjustable column order; surface rejected saves in the full view ([#337](https://github.com/chrreiter/HAventory/issues/337)) ([a2ce539](https://github.com/chrreiter/HAventory/commit/a2ce5394265b50339d1386870388381dbbd05ba5))
* **card:** attach files by dropping them on the editor ([#338](https://github.com/chrreiter/HAventory/issues/338)) ([0a4d7c6](https://github.com/chrreiter/HAventory/commit/0a4d7c6b16ef93a305fd119f8dc92df445979013)), closes [#296](https://github.com/chrreiter/HAventory/issues/296)
* **card:** banners and row actions reach the full view and panel ([#346](https://github.com/chrreiter/HAventory/issues/346)) ([39a9cc8](https://github.com/chrreiter/HAventory/commit/39a9cc805e03402f4f2eb7f0c92b0758ef91e0c9))
* **card:** configurable quick-filter pills ([#339](https://github.com/chrreiter/HAventory/issues/339)) ([cc07185](https://github.com/chrreiter/HAventory/commit/cc07185b02fc63210384718ed6e1fbebe25aa285)), closes [#241](https://github.com/chrreiter/HAventory/issues/241)
* **card:** guarded attachment removal, escape discipline, first-run location create, visible upload progress ([#319](https://github.com/chrreiter/HAventory/issues/319)) ([8ac7adf](https://github.com/chrreiter/HAventory/commit/8ac7adfe62a72ab9cbe356be5d7f9267666f4a61))
* **card:** lightbox navigation; deduplicated document rows ([#324](https://github.com/chrreiter/HAventory/issues/324)) ([20b556c](https://github.com/chrreiter/HAventory/commit/20b556c0e7f9cebe5831ff819b18b0a795c6537c))
* **card:** organize is one click away; dense status rows; one delete confirmation ([#342](https://github.com/chrreiter/HAventory/issues/342)) ([7b9b2b2](https://github.com/chrreiter/HAventory/commit/7b9b2b2ab549d40b16b24b52acc662ab8d47c082))
* **card:** shared read view and lightbox on every surface ([#347](https://github.com/chrreiter/HAventory/issues/347)) ([5ab5750](https://github.com/chrreiter/HAventory/commit/5ab5750fbd5888f799a5ecf028f660ffc1bd41ef))
* custom statuses, PDF manuals and the photo UX pass (UI halves of [#260](https://github.com/chrreiter/HAventory/issues/260)/[#261](https://github.com/chrreiter/HAventory/issues/261)) ([#299](https://github.com/chrreiter/HAventory/issues/299)) ([1798946](https://github.com/chrreiter/HAventory/commit/1798946c846ddf04f8a8759d1b51ebcb39e2e747))
* item photos, attachment backend and status definitions (schema v6) ([#294](https://github.com/chrreiter/HAventory/issues/294)) ([87bd4d4](https://github.com/chrreiter/HAventory/commit/87bd4d462cb403756fa4d08cce9f75efb9185597))


### Bug Fixes

* **card:** a dirty editor always asks before discarding, on every close path ([#345](https://github.com/chrreiter/HAventory/issues/345)) ([8f3b57d](https://github.com/chrreiter/HAventory/commit/8f3b57de8047670b1b13bc635714360401e54e59))
* **card:** AA state-chip ink, distinct blue tones, status-toned filter chips ([#311](https://github.com/chrreiter/HAventory/issues/311)) ([74c787b](https://github.com/chrreiter/HAventory/commit/74c787bb15a163e775b89867ab1b679f580e2634))
* **card:** consistency sweep — cursors, buttons, copy, bulk check-out date ([#352](https://github.com/chrreiter/HAventory/issues/352)) ([9aaf2d0](https://github.com/chrreiter/HAventory/commit/9aaf2d0e2aa47230ec31028d7d7c6dd346457da9))
* **card:** deliver shell state to the inline editor through hv-list ([#327](https://github.com/chrreiter/HAventory/issues/327)) ([51f9507](https://github.com/chrreiter/HAventory/commit/51f95077cf487cb1e659f051f70c78ea0c6cbe88))
* **card:** editor geometry and type reconciliation; always-visible actions; honest custom-fields tally ([#343](https://github.com/chrreiter/HAventory/issues/343)) ([d0e15dc](https://github.com/chrreiter/HAventory/commit/d0e15dc8839c1f458ed4f7019896e44ddc63a261))
* **card:** host dialogs switch on the viewport, not the card width ([#341](https://github.com/chrreiter/HAventory/issues/341)) ([d715864](https://github.com/chrreiter/HAventory/commit/d7158646727da6688c29b633bd44dddf24f6757a))
* **card:** keep the open editor and its edits across filter, search and sort changes ([#336](https://github.com/chrreiter/HAventory/issues/336)) ([aa856d2](https://github.com/chrreiter/HAventory/commit/aa856d2d2cad4e7f76288830dfc3d6ed46ba664c)), closes [#332](https://github.com/chrreiter/HAventory/issues/332)
* **card:** keep unsaved edits and upload errors across same-item refreshes ([#306](https://github.com/chrreiter/HAventory/issues/306)) ([8a06a76](https://github.com/chrreiter/HAventory/commit/8a06a7650f75be2422665ea6c82c3962d3b2b2a3))
* **card:** make the Statuses tab usable on touch — stacking guard, real targets, legible swatches, editable default ([#317](https://github.com/chrreiter/HAventory/issues/317)) ([2113629](https://github.com/chrreiter/HAventory/commit/211362967cafe4e44e245b7fbbf05d8b39c948f4))
* **card:** price statuses from status_counts and survive payload-less item events ([#308](https://github.com/chrreiter/HAventory/issues/308)) ([11a29b6](https://github.com/chrreiter/HAventory/commit/11a29b61625a6734b996c3adf5e85f9522ee63e3))
* **card:** scroll organize-dialog disclosures into view; touch parity across all tabs ([#329](https://github.com/chrreiter/HAventory/issues/329)) ([072ff44](https://github.com/chrreiter/HAventory/commit/072ff44fe751a3865914df79cab7bfff304418a3))
* **card:** sticky name column, name-first table layout, anchored document marker ([#313](https://github.com/chrreiter/HAventory/issues/313)) ([20ae037](https://github.com/chrreiter/HAventory/commit/20ae037a7d186a8156fdd8aaa239fe7a6878bf13))
* **card:** tell the truth about a lost connection ([#351](https://github.com/chrreiter/HAventory/issues/351)) ([602bf71](https://github.com/chrreiter/HAventory/commit/602bf710b307653185f7a171548466c1ae93d727))
* **ws:** run upload consume and teardown off the event loop ([#330](https://github.com/chrreiter/HAventory/issues/330)) ([1e6c7e4](https://github.com/chrreiter/HAventory/commit/1e6c7e43cb6164d6040a08303d8b1f6db002c092))


### Documentation

* add v0.4.0 follow-up remediation plan for three parallel work packages ([#325](https://github.com/chrreiter/HAventory/issues/325)) ([d131346](https://github.com/chrreiter/HAventory/commit/d13134656bb61f47c746fe9a2d2c6d2b83e26870))
* **dev:** add v0.4.0 UI-audit remediation plan ([#305](https://github.com/chrreiter/HAventory/issues/305)) ([438c4cd](https://github.com/chrreiter/HAventory/commit/438c4cddd0920b5d13c105fa59d8d1489b334ecc))
* UI/UX audit for v0.4.0 optimization pass ([#304](https://github.com/chrreiter/HAventory/issues/304)) ([9376ce2](https://github.com/chrreiter/HAventory/commit/9376ce2e847dda9a40b58383940abf545aec09fe))
* v0.4.0 frontend completeness plan and campaign rules ([#335](https://github.com/chrreiter/HAventory/issues/335)) ([88fadb4](https://github.com/chrreiter/HAventory/commit/88fadb42af466620d127a67ecf00eecfe1ac32fe))

## [0.3.3](https://github.com/chrreiter/HAventory/compare/v0.3.2...v0.3.3) (2026-08-05)


### Bug Fixes

* **hooks:** stop the session hook destroying the integration env ([#290](https://github.com/chrreiter/HAventory/issues/290)) ([f675ec3](https://github.com/chrreiter/HAventory/commit/f675ec3284ce0c488268e912ea1390650ed2037e))
* V0.3.3 — clean-slate fixes ahead of V0.4.0 ([#287](https://github.com/chrreiter/HAventory/issues/287)) ([1cce96e](https://github.com/chrreiter/HAventory/commit/1cce96e1b337fcd2bcae7ed2bf33180e6a559a77))

## [0.3.2](https://github.com/chrreiter/HAventory/compare/v0.3.1...v0.3.2) (2026-08-05)


### Bug Fixes

* **test-harness:** close the WS session on every connect() failure path ([#270](https://github.com/chrreiter/HAventory/issues/270)) ([1f2bcca](https://github.com/chrreiter/HAventory/commit/1f2bccaa33e88767b931fd05af303802ac91b0bb)), closes [#266](https://github.com/chrreiter/HAventory/issues/266)


### Documentation

* add public-release review (competitive position, code audit, roadmap) ([#267](https://github.com/chrreiter/HAventory/issues/267)) ([345532a](https://github.com/chrreiter/HAventory/commit/345532a73be397dc8a4ceb8be551a32bd3f2846a))
* correct CLAUDE.md staging claims, retire the ledger, split docs/ and dev/ ([#271](https://github.com/chrreiter/HAventory/issues/271)) ([0bcb6e7](https://github.com/chrreiter/HAventory/commit/0bcb6e7929e933c79f0326c7bfc6d8981eb05b20)), closes [#269](https://github.com/chrreiter/HAventory/issues/269)
* **skills:** refresh stale test counts and frame them as a growth oracle ([#272](https://github.com/chrreiter/HAventory/issues/272)) ([a7081ee](https://github.com/chrreiter/HAventory/commit/a7081eea9a4e387e639d07fe4df822f4c799b13e)), closes [#265](https://github.com/chrreiter/HAventory/issues/265)
* **skills:** scope the Windows/Git Bash notes to the host they apply to ([#275](https://github.com/chrreiter/HAventory/issues/275)) ([a026a64](https://github.com/chrreiter/HAventory/commit/a026a643918c35fef6475a4885ecb753ef85eb46))

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
