/**
 * The key universe.
 *
 * Every string the card can say is here, and `TranslationKey` is derived from
 * it — so a key that exists in no dictionary is a compile error at the call
 * site, and a dictionary carrying a key this file has dropped is one at its
 * own. English is also the fallback every other dictionary degrades to, which
 * is why this one is the complete one by construction.
 *
 * Conventions:
 *
 * - Keys are `hv.<area>.<thing>`, lower camel inside a segment.
 * - `{name}` placeholders are filled by `t(key, params)`; a placeholder with no
 *   parameter renders literally, so a typo shows up rather than blanking a word.
 * - A counted string is written here as `<key>.one` and `<key>.other` and
 *   reached through `tn(key, count)`, which asks `Intl.PluralRules` which form
 *   the count wants in the language in force. English needs those two; another
 *   language may need `few` and `many` beside them, or only `other`. `{count}`
 *   is passed in for every form, and a form may leave the number out — German
 *   writes "täglich" where English writes "every day".
 * - Whole sentences, not fragments glued at the call site: word order is a
 *   language's own, and a sentence assembled from three keys can only ever be
 *   English word order with foreign words in it.
 */

export const en = {
  // Shared verbs. One key each, because German has one word each and thirty
  // copies of "Aktualisieren" is thirty chances to drift.
  'hv.action.refresh': 'Refresh',
  'hv.action.retry': 'Try again',
  'hv.action.dismiss': 'Dismiss',
  'hv.action.discard': 'Discard',

  // ui/empty-state — the ways a list can have no rows.
  'hv.empty.loading.headline': 'Loading items',
  'hv.empty.connectionLost.headline': "Can't reach Home Assistant",
  'hv.empty.connectionLost.detail': 'The list will fill in once the connection is back.',
  'hv.empty.noMatches.headline': 'No items match these filters',
  'hv.empty.emptyLocation.headline': 'Nothing in {location}',
  // A separate sentence rather than a "this location" filler in the one above:
  // German takes a different preposition for a named place than for an unnamed
  // one, and a language that inflects the name cannot borrow either.
  'hv.empty.emptyLocation.headlineUnnamed': 'Nothing in this location',
  'hv.empty.emptyLocation.addAction': 'Add item here',
  'hv.empty.emptyLocation.clearAction': 'Show everything',
  'hv.empty.noItems.headline': 'No items yet',
  'hv.empty.noItems.detail': 'Add your first item, or restore a backup.',
  'hv.empty.noItems.addAction': 'Add your first item',

  // ui/banners — the two stacks that say something is wrong.
  'hv.banner.connectionLost.heading': 'Connection lost',
  'hv.banner.connectionLost.message': ' · showing the data already loaded. Changes may not save.',
  'hv.banner.connectionLost.action': 'Reconnect',
  'hv.banner.liveUpdates.heading': 'Live updates paused',
  'hv.banner.liveUpdates.cause.unavailable': 'HAventory is not available',
  'hv.banner.liveUpdates.retrying':
    ' · {cause}. Retrying automatically; this list may be out of date until then.',
  'hv.banner.liveUpdates.stalled': ' · {cause}. This list may be out of date until you refresh.',
  'hv.banner.reloading.heading': 'Inventory was replaced by an import',
  'hv.banner.reloading.message': ' · reloading…',
  // Also what an open editor says about a rejected save — one sentence for one
  // event, wherever the card reports it.
  'hv.banner.conflict.heading': 'Someone else changed this item.',
  'hv.banner.conflict.viewLatest': 'View latest',
  'hv.banner.conflict.reapply': 'Re-apply my change',

  // ui/discard — the one question asked before typed edits are thrown away.
  'hv.discard.heading': 'Discard your changes?',
  'hv.discard.message': 'What you have typed since the last save is lost.',

  // ui/plural — a count and the noun it counts, for a tally that stands alone.
  // A count inside a sentence gets a key for the whole sentence instead.
  'hv.count.item.one': '{count} item',
  'hv.count.item.other': '{count} items',
  'hv.count.location.one': '{count} location',
  'hv.count.location.other': '{count} locations',
  'hv.count.subLocation.one': '{count} sub-location',
  'hv.count.subLocation.other': '{count} sub-locations',
  'hv.count.tag.one': '{count} tag',
  'hv.count.tag.other': '{count} tags',
  'hv.count.category.one': '{count} category',
  'hv.count.category.other': '{count} categories',
  'hv.count.status.one': '{count} status',
  'hv.count.status.other': '{count} statuses',
  'hv.count.field.one': '{count} field',
  'hv.count.field.other': '{count} fields',
  'hv.count.filter.one': '{count} filter',
  'hv.count.filter.other': '{count} filters',
  'hv.count.problem.one': '{count} problem',
  'hv.count.problem.other': '{count} problems',
  'hv.count.conflict.one': '{count} conflict',
  'hv.count.conflict.other': '{count} conflicts',
  'hv.count.nameClash.one': '{count} name clash',
  'hv.count.nameClash.other': '{count} name clashes',
  'hv.count.failedRow.one': '{count} failed row',
  'hv.count.failedRow.other': '{count} failed rows',

  // ui/plural — the line under a list saying how much of the set is on screen.
  'hv.list.showingAll.one': 'Showing {count} item',
  'hv.list.showingAll.other': 'Showing {count} items',
  'hv.list.showingOf.one': 'Showing {loaded} of {count} item',
  'hv.list.showingOf.other': 'Showing {loaded} of {count} items',
  'hv.list.showingOfMatching.one': 'Showing {loaded} of {count} matching item',
  'hv.list.showingOfMatching.other': 'Showing {loaded} of {count} matching items',

  // ui/value-rewrite — what renaming a tag or a category is about to do.
  'hv.rewrite.tag.remove.one': 'Removes "{from}" from {count} item.',
  'hv.rewrite.tag.remove.other': 'Removes "{from}" from {count} items.',
  'hv.rewrite.tag.retag.one': 'Retags {count} item, then removes "{from}".',
  'hv.rewrite.tag.retag.other': 'Retags {count} items, then removes "{from}".',
  'hv.rewrite.category.clear.one': 'Clears the category on {count} item.',
  'hv.rewrite.category.clear.other': 'Clears the category on {count} items.',
  'hv.rewrite.category.set.one': 'Recategorises {count} item as "{to}".',
  'hv.rewrite.category.set.other': 'Recategorises {count} items as "{to}".',

  // ui/relative-time — everything `Intl` does not already say in the user's
  // language. The spans themselves come from `Intl.RelativeTimeFormat`.
  'hv.time.justNow': 'just now',
  'hv.date.offsetDays': '+{days} days',

  // ui/reminder — how a repeat is written. `every 1 days` is not a sentence in
  // any language, so the singular form is its own wording in each.
  'hv.reminder.every.days.one': 'every day',
  'hv.reminder.every.days.other': 'every {count} days',
  'hv.reminder.every.weeks.one': 'every week',
  'hv.reminder.every.weeks.other': 'every {count} weeks',
  'hv.reminder.every.months.one': 'every month',
  'hv.reminder.every.months.other': 'every {count} months',

  // ui/media — what a screen reader says about an item's photo.
  'hv.media.photoAlt': '{name} — photo {index} of {total}',
  'hv.media.photoAltOnly': 'Photo of {name}',

  // ui/location-path — the area beside a path.
  'hv.area.prefix': 'Area: {name}',
  // Read out before the chip's name, for anyone who cannot see the glyph that
  // says the same thing. The trailing space is part of the announcement.
  'hv.area.srPrefix': 'Area: ',

  // ui/keyboard — the save chord, on a keyboard without a Command key.
  'hv.shortcut.ctrlEnter': 'Ctrl+Enter',

  // Counted sentences that belong to no one component group. `ui/plural`
  // derives no English plural, so both forms are written out.
  'hv.bulk.result.failed.one': '{count} failed and was left unchanged.',
  'hv.bulk.result.failed.other': '{count} failed and were left unchanged.',
  'hv.fullView.checkedOutWarning.one': '{count} of them is checked out',
  'hv.fullView.checkedOutWarning.other': '{count} of them are checked out',
  'hv.surfaces.exportView.filtered.one': '{count} filtered item · Keeps location paths',
  'hv.surfaces.exportView.filtered.other': '{count} filtered items · Keeps location paths',

  // ui/item-form — what the editor refuses to save, and why.
  'hv.form.error.nameRequired': 'Name is required.',
  'hv.form.error.nameTooLong': 'Name is limited to {max} characters.',
  'hv.form.error.descriptionTooLong': 'Description is limited to {max} characters.',
  'hv.form.error.categoryTooLong': 'Category is limited to {max} characters.',
  'hv.form.error.quantityNegative': "Quantity can't be negative.",
  'hv.form.error.lowStockRange': 'Low-stock threshold must be 0 or more, or empty.',
  'hv.form.error.tooManyTags': 'An item can carry at most {max} tags.',
  'hv.form.error.tagTooLong': 'Each tag is limited to {max} characters.',
  'hv.form.error.reminderRange': 'Repeat every 1 to {max}, or leave it empty for a one-off.',
  'hv.form.error.customFieldDuplicate': '"{key}" is used twice.',
  'hv.form.error.customFieldKeyTooLong': 'Field names are limited to {max} characters.',
  'hv.form.error.customFieldNotNumber': '"{key}" must be a number.',
  'hv.form.error.customFieldNotDate': '"{key}" must be a date.',
  'hv.form.error.customFieldValueTooLong': '"{key}" is limited to {max} characters.',
  'hv.form.error.tooManyCustomFields': 'An item can carry at most {max} custom fields.',

  // Shared verbs the components reach for. One key each, because German has
  // one word each and twenty copies of "Abbrechen" is twenty chances to drift.
  'hv.action.cancel': 'Cancel',
  'hv.action.save': 'Save',
  'hv.action.saving': 'Saving…',
  'hv.action.close': 'Close',
  'hv.action.edit': 'Edit',
  'hv.action.create': 'Create',
  'hv.action.apply': 'Apply',
  'hv.action.confirm': 'Confirm',
  'hv.action.delete': 'Delete',
  'hv.action.remove': 'Remove',
  'hv.action.back': 'Back',
  'hv.action.open': 'Open',
  'hv.action.repeat': 'Retry',
  'hv.action.clearAll': 'Clear all',
  // The × on a chip, spoken rather than drawn: the chip's own text is beside
  // it on screen, and an accessible name has to carry it instead.
  'hv.action.clearFilter': 'Clear filter {label}',
  'hv.action.removeTag': 'Remove {tag}',
  'hv.action.deleteItem': 'Delete item',
  'hv.action.editItem': 'Edit item',
  'hv.action.checkIn': 'Check in',
  'hv.action.checkOut': 'Check out',
  'hv.action.checkOutEllipsis': 'Check out…',
  'hv.action.copy': 'Copy',
  'hv.action.copied': 'Copied',

  // Words the card names a fact with, wherever it names one.
  // The first stands in for an item whose name is not to hand.
  'hv.term.item': 'Item',
  'hv.term.noLocation': 'No location',
  'hv.term.noArea': 'No area',
  'hv.term.checkedOut': 'Checked out',
  'hv.term.overdue': 'Overdue',
  'hv.term.inspectionDue': 'Inspection due',
  'hv.term.low': 'Low',
  'hv.term.lowStock': 'Low stock',
  'hv.term.lowStockFirst': 'Low stock first',
  'hv.term.notSet': 'Not set',
  'hv.term.yes': 'Yes',
  'hv.term.no': 'No',
  'hv.term.fileMissing': 'File missing',
  // The label over an item's or a location's uuid, on both surfaces that print
  // one. Deliberately the initialism rather than "Identifier": it is what the
  // service fields are called (`item_id`, `location_id`), which is what the
  // household is about to paste it into.
  'hv.term.id': 'ID',
  'hv.term.due': 'due {date}',
  'hv.term.overdueOn': 'Overdue · {date}',
  'hv.term.inspectionDueOn': 'Inspection due · {date}',

  // hv-card-shell — the card's own header, search row and sheets.
  'hv.card.badge.low': '{count} low',
  'hv.card.badge.lowTitle': 'Show only low-stock items',
  'hv.card.badge.overdue': '{count} overdue',
  'hv.card.badge.overdueTitle': 'Show only overdue items',
  'hv.card.badge.inspection': '{count} to inspect',
  'hv.card.badge.inspectionTitle': 'Show only items due for inspection',
  'hv.card.badge.reminder': '{count} to do',
  'hv.card.badge.reminderTitle': 'Show only items whose reminder has come round',
  'hv.card.badge.checkedOut': '{count} checked out',
  'hv.card.badge.checkedOutTitle': 'Show only checked-out items',
  'hv.card.openFullView': 'Open full view',
  'hv.card.addItem': 'Add item',
  'hv.card.addShort': 'Add',
  'hv.card.searchItems': 'Search items',
  'hv.card.searchPlaceholder': 'Search items…',
  'hv.card.searchAllPlaceholder.one': 'Search all {count} item…',
  'hv.card.searchAllPlaceholder.other': 'Search all {count} items…',
  'hv.card.filters': 'Filters',
  'hv.card.filtersActive': '{count} active',
  'hv.card.showItems': 'Show items',
  'hv.card.showCount.one': 'Show {count} item',
  'hv.card.showCount.other': 'Show {count} items',
  'hv.card.notConnected': 'Not connected to Home Assistant yet.',

  // hv-list — the one row the list draws that is not an item.
  'hv.list.noLongerMatches': 'No longer matches the current filters',

  // hv-list-row.
  'hv.row.label': 'Item {name}',
  'hv.row.hasDocument': 'Has a document',
  'hv.row.decreaseQuantity': 'Decrease quantity',
  'hv.row.increaseQuantity': 'Increase quantity',
  'hv.row.editNamed': 'Edit {name}',
  'hv.row.actionsFor': 'Actions for {name}',
  'hv.row.menu.changeDueDate': 'Change due date…',
  'hv.row.menu.setDueDate': 'Set due date…',

  // hv-detail-sheet.
  'hv.sheet.documentAdded': 'added {when}',
  'hv.sheet.openPhoto': 'Open {photo}',
  'hv.sheet.lowStockAt': 'low-stock at {threshold}',
  'hv.sheet.updatedValue': '{when} · v{version}',
  'hv.sheet.markDone': 'Mark done',
  'hv.sheet.markDoneTitle': 'Mark this reminder done and move it to its next occurrence',
  'hv.sheet.editDetails': 'Edit details',

  // hv-item-editor.
  'hv.editor.heading.new': 'New item',
  'hv.editor.heading.editing': '{name} — editing',
  'hv.editor.version': 'v{version} · updated {when}',
  'hv.editor.close': 'Close editor',
  'hv.editor.field.tagsNote': '· always lowercase',
  'hv.editor.categoryPlaceholder': 'No category',
  'hv.editor.showAllCategories': 'Show all categories',
  'hv.editor.categoryEmpty': 'No existing category matches “{typed}” — saving adds it as a new one.',
  'hv.editor.locationCreateFailed': 'The location could not be created.',
  'hv.editor.checkOutCaption': 'Check out',
  'hv.editor.dueDateHint': 'A due date applies while the item is checked out.',
  'hv.editor.thisItem': 'this item',
  'hv.editor.clearInspectionDate': 'Clear inspection date',
  'hv.editor.reminderDate': 'Reminder date',
  'hv.editor.repeatEvery': 'Repeat every',
  'hv.editor.repeatUnit': 'Repeat unit',
  'hv.editor.reminderHint': 'Pick a date first; leave the repeat empty for a one-off.',
  'hv.editor.unit.days': 'days',
  'hv.editor.unit.weeks': 'weeks',
  'hv.editor.unit.months': 'months',
  'hv.editor.customDaysOffset': '+X days',
  'hv.editor.daysFromToday': 'days from today',
  'hv.editor.customFields': 'Custom fields',
  'hv.editor.fieldsSet': '{fields} set',
  'hv.editor.fieldKey': 'Field key',
  'hv.editor.fieldKeyPlaceholder': 'key',
  'hv.editor.fieldType': 'Field type',
  'hv.editor.fieldValue': 'Field value',
  'hv.editor.removeField': 'Remove field',
  'hv.editor.removeNamedField': 'Remove {key}',
  'hv.editor.fieldFallbackName': 'field',
  'hv.editor.addField': 'Add field',
  'hv.editor.keySuggestions': 'Key suggestions:',
  'hv.editor.clearingUnsets': 'Clearing a value unsets the key on save.',
  'hv.editor.type.string': 'Text',
  'hv.editor.type.number': 'Number',
  'hv.editor.type.boolean': 'Yes/No',
  'hv.editor.type.date': 'Date',
  'hv.editor.photos': 'Photos',
  'hv.editor.addPhoto': 'Add photo',
  'hv.editor.viewPhoto': 'View {photo}',
  'hv.editor.removePhoto': 'Remove {photo}',
  'hv.editor.movePhotoEarlier': 'Move photo {position} earlier',
  'hv.editor.movePhotoLater': 'Move photo {position} later',
  'hv.editor.makeCover': 'Make cover',
  'hv.editor.makePhotoCover': 'Make photo {position} the cover',
  'hv.editor.coverPhoto': 'Cover photo',
  'hv.editor.addManual': 'Add manual',
  'hv.editor.openDocument': 'Open document',
  'hv.editor.openNamed': 'Open {name}',
  'hv.editor.removeNamed': 'Remove {name}',
  'hv.editor.titleFor': 'Title for {filename}',
  'hv.editor.attachmentsLater': 'Photos and documents',
  'hv.editor.attachmentsHint': 'Save the item first to add photos and manuals.',
  'hv.editor.upload.retryNamed': 'Try {name} again',
  'hv.editor.upload.dismissNamed': 'Dismiss the error for {name}',
  'hv.editor.upload.progress': '{name}: {state}',
  'hv.editor.upload.state.queued': 'queued…',
  'hv.editor.upload.state.preparing': 'preparing…',
  'hv.editor.upload.state.uploading': 'uploading…',
  'hv.editor.upload.failed': 'Upload failed.',
  'hv.editor.upload.reorderPhotos': 'Reorder photos',
  'hv.editor.upload.removeDocument': 'Remove document',
  'hv.editor.upload.removePhoto': 'Remove photo',
  'hv.editor.upload.renameDocument': 'Rename document',
  'hv.editor.preflight.tooManyDocuments': '{cap} documents is the limit for one item.',
  'hv.editor.preflight.tooManyPhotos': '{cap} photos is the limit for one item.',
  'hv.editor.preflight.tooBig': '{size} is over the {limit} limit.',
  'hv.editor.preflight.badDocumentType': '{type} is not an accepted document type.',
  'hv.editor.preflight.badImageType': '{type} is not an accepted image type.',
  'hv.editor.removePhoto.heading': 'Remove this photo?',
  'hv.editor.removePhoto.message': 'The photo file is deleted with it, and there is no way back.',
  'hv.editor.removeDocument.heading': 'Remove this document?',
  'hv.editor.removeDocument.message': 'The document file is deleted with it, and there is no way back.',
  'hv.editor.keyHint': 'Esc closes · {chord} saves',

  // hv-checkout-popover.
  'hv.checkout.setDueDate': 'Set due date',
  'hv.checkout.setADueDate': 'Set a due date',
  'hv.checkout.checkOutNamed': 'Check out {name}',
  'hv.checkout.sub': "A due date is optional — it's what makes overdue highlighting work.",
  'hv.checkout.noDueDate': 'No due date',
  'hv.checkout.clearDueDate': 'Clear due date',
  'hv.checkout.withoutDueDate': 'Check out with no due date',
  'hv.checkout.confirmWithDate': '{action} · due {date}',

  // hv-location-tree.
  'hv.tree.allItems': 'All items',
  'hv.tree.noneMatch': 'No locations match',
  'hv.tree.noneYet': 'No locations yet',
  'hv.tree.newLocation': 'New location…',
  'hv.tree.locationNamePlaceholder': 'Location name',
  'hv.tree.collapse': 'Collapse {name}',
  'hv.tree.expand': 'Expand {name}',
  'hv.tree.merge': 'Merge {name}',
  'hv.tree.mergeTitle': 'Merge into another location',
  'hv.tree.editTitle': 'Edit location',
  'hv.tree.delete': 'Delete {name}',
  'hv.tree.deleteTitle': 'Delete location',

  // hv-confirm, hv-bottom-sheet, hv-chip-input, hv-lightbox — the defaults each
  // one carries when its host names nothing.
  'hv.confirm.heading': 'Are you sure?',
  'hv.bottomSheet.label': 'Details',
  'hv.chipInput.placeholder': 'Add tag…',
  'hv.lightbox.close': 'Close photo',
  'hv.lightbox.previous': 'Previous photo',
  'hv.lightbox.next': 'Next photo',
  'hv.lightbox.counter': '{index} of {total}',

  // host-surfaces — the ⋮ menu both full-screen surfaces serve, and the
  // dialogs they own.
  'hv.surfaces.delete.heading': 'Delete "{name}"?',
  'hv.surfaces.delete.message': 'This cannot be undone. The item is removed for every connected client.',
  'hv.surfaces.menu.selectItems': 'Select items…',
  'hv.surfaces.menu.organize': 'Organize…',
  'hv.surfaces.menu.organizeMeta': 'Locations · Tags · Categories · Statuses',
  'hv.surfaces.menu.columns': 'Columns…',
  'hv.surfaces.menu.refresh': 'Refresh data',
  'hv.surfaces.menu.refreshMeta': 'Items · Locations · Stats',
  'hv.surfaces.menu.data': 'Data',
  'hv.surfaces.menu.exportAll': 'Export backup',
  'hv.surfaces.menu.exportAllSub': 'Everything',
  'hv.surfaces.menu.exportAllCount.one': 'All {count} item · All locations',
  'hv.surfaces.menu.exportAllCount.other': 'All {count} items · All locations',
  'hv.surfaces.menu.exportView': 'Export current view',
  'hv.surfaces.menu.exportViewSub': 'Active filter · Keeps location paths',
  'hv.surfaces.menu.import': 'Import backup…',
  'hv.surfaces.badge.offline': 'offline',
  'hv.surfaces.columnsHeading': 'Full view columns',
  'hv.surfaces.importCheckFailed': 'Could not check that document.',
  'hv.surfaces.importFailed': 'The import failed.',

  // haventory-card-editor — the one field Home Assistant's card editor shows.
  'hv.cardEditor.title': 'Title',

  // Shared — the verbs and terms more than one component reads.
  'hv.action.set': 'Set',
  'hv.action.done': 'Done',
  'hv.action.rename': 'Rename',
  'hv.action.merge': 'Merge',
  'hv.action.dismissEntry': 'Dismiss',
  'hv.term.any': 'Any',
  'hv.term.all': 'All',
  'hv.term.moveUp': 'Move up',
  'hv.term.moveDown': 'Move down',

  // What the card calls a field of an item, wherever it names one: a column
  // header, a sort option, an editor label, a facet's tab or section, a fact
  // row in the detail sheet. One key per word rather than one per surface —
  // the same noun in the same role, and a language that would need two of them
  // for two surfaces has not turned up yet.
  //
  // The date fields keep the backend's spelling because the call sites that
  // build the key finish it with a `ColumnKey` or a `SortField`; the plurals
  // are spelled as the organize dialog's `OrganizeTab` values, for the same
  // reason.
  'hv.field.name': 'Name',
  'hv.field.quantity': 'Quantity',
  'hv.field.status': 'Status',
  'hv.field.category': 'Category',
  'hv.field.location': 'Location',
  'hv.field.tags': 'Tags',
  'hv.field.description': 'Description',
  'hv.field.lowStock': 'Low-stock at',
  'hv.field.documents': 'Documents',
  'hv.field.due_date': 'Due date',
  'hv.field.inspection_date': 'Next inspection',
  'hv.field.reminder_date': 'Reminder',
  'hv.field.updated_at': 'Updated',
  'hv.field.created_at': 'Created',
  // The short spellings, for the slots that are narrower than the word: two
  // table columns on a fixed track, and the detail sheet's fact rows.
  'hv.field.quantityShort': 'Qty',
  'hv.field.dueShort': 'Due',
  // A whole set of one field's values, which is what a tab, a sidebar section
  // and the import preview's tables name.
  'hv.field.locations': 'Locations',
  'hv.field.categories': 'Categories',
  'hv.field.statuses': 'Statuses',

  // The three statuses a store is seeded with. A status a household created is
  // its own words and renders as stored; these three are nobody's words until
  // somebody renames one, so the card prints them in the reader's language for
  // as long as each still carries the English the backend wrote. The store
  // itself never sees these strings — `ui/status.ts` has the rule.
  'hv.status.ok': 'OK',
  'hv.status.missing': 'Missing',
  'hv.status.needs_repair': 'Needs repair',

  // store — what the card says when a command does not come back. The
  // backend's own `message` text is not translated; these are the card's.
  'hv.store.transportError': 'Could not reach Home Assistant — the last action did not go through.',
  'hv.store.unknownError': 'Unknown error',
  'hv.store.operationFailed': 'Operation failed',
  'hv.store.batchFailed': 'Batch failed',
  'hv.store.noResult': 'no result returned for this operation',
  'hv.store.cannotUpload': 'This Home Assistant connection cannot upload files.',
  'hv.store.uploadFailed': 'Upload failed ({status})',

  // hv-overflow-menu, hv-column-picker.
  'hv.menu.label': 'More actions',
  'hv.columns.heading': 'Columns',
  'hv.columns.dialogLabel': 'Column selection',
  'hv.columns.moveUp': 'Move {column} up',
  'hv.columns.moveDown': 'Move {column} down',
  'hv.columns.resetOrder': 'Reset order',

  // hv-filter-chips — each chip names its own facet, because the row has no
  // headings above it and a bare value could be any of them.
  'hv.chips.plusSub': '{paths} + sub',
  'hv.chips.category': 'Category: {values}',
  'hv.chips.categories': 'Categories: {values}',
  'hv.chips.tagsAny': 'any of: {values}',
  'hv.chips.tagsAll': 'all of: {values}',
  'hv.chips.status': 'Status: {label}',
  'hv.chips.lowStockOnly': 'Low stock only',
  'hv.chips.updatedAfter': 'Updated ≥',
  'hv.chips.updatedBefore': 'Updated ≤',
  'hv.chips.createdAfter': 'Created ≥',
  'hv.chips.createdBefore': 'Created ≤',
  'hv.chips.dated': '{prefix} {date}',

  // hv-filter-panel.
  'hv.filter.where': 'Where',
  'hv.filter.anyLocation': 'Any location',
  'hv.filter.area': 'Area',
  'hv.filter.areaAny': 'Area: Any',
  'hv.filter.includeSubtree': 'Include sub-locations',
  'hv.filter.more': 'More…',
  'hv.filter.categoryHint': 'Any of the picked categories',
  'hv.filter.tagMatchMode': 'Tag match mode',
  'hv.filter.addTag': 'Add tag',
  'hv.filter.addTagPlaceholder': '+ add tag…',
  'hv.filter.tagsHint': 'Tags are always lowercase',
  'hv.filter.showOnly': 'Show only',
  'hv.filter.changed': 'Changed',
  'hv.filter.dateSince': '{noun} since',
  'hv.filter.dateBefore': '{noun} before',
  'hv.filter.dateFlipToSince': '{noun} before — switch to since',
  'hv.filter.dateFlipToBefore': '{noun} since — switch to before',
  'hv.filter.dateTitleBefore': 'Before this date — click for "since"',
  'hv.filter.dateTitleSince': 'Since this date — click for "before"',
  'hv.filter.sort': 'Sort',
  'hv.filter.sortBy': 'Sort by',
  'hv.filter.sortDirection': 'Sort direction',
  'hv.filter.newest': 'Newest',
  'hv.filter.oldest': 'Oldest',
  'hv.filter.descending': 'Descending',
  'hv.filter.ascending': 'Ascending',
  'hv.filter.sortHint': 'Undated items always sort last, in both directions',
  'hv.filter.summary': '{filters} active',
  'hv.filter.summaryMatching': '{filters} active · {total} of {grandTotal} match',

  // hv-data-table.
  'hv.table.selectAll': 'Select all loaded rows',
  'hv.table.select': 'Select {name}',

  // hv-bulk-bar.
  'hv.bulk.toolbar': 'Bulk actions',
  'hv.bulk.applyTo': 'Apply to {items}',
  'hv.bulk.action.move': 'Move to…',
  'hv.bulk.action.addTags': 'Add tags…',
  'hv.bulk.action.removeTags': 'Remove tags…',
  'hv.bulk.action.setCategory': 'Set category…',
  'hv.bulk.action.adjustQty': 'Adjust qty…',
  'hv.bulk.moveTo': 'Move {items} to',
  'hv.bulk.addTagsTo': 'Add tags to {items}',
  'hv.bulk.removeTagsFrom': 'Remove tags from {items}',
  'hv.bulk.setCategoryOn': 'Set the category on {items}',
  'hv.bulk.categoryPlaceholder': 'Category (blank clears it)',
  'hv.bulk.adjustQtyOf': 'Adjust the quantity of {items} by',
  'hv.bulk.deltaPlaceholder': 'e.g. -1',
  'hv.bulk.progress': '{label} {done} of {total}',
  'hv.bulk.progressFailed': '{count} failed',
  'hv.bulk.finished': '{label} finished',
  'hv.bulk.finishedWithErrors': '{label} finished with errors',
  'hv.bulk.succeeded': '{done} of {total} succeeded.',
  'hv.bulk.selectionKept': 'Selection kept to the {rows}',
  'hv.bulk.retryFailed': 'Retry {count} failed',
  'hv.bulk.failure.conflict': 'Conflict — changed by another client since you loaded it.',
  'hv.bulk.failure.notFound': 'Not found — deleted before this ran.',
  'hv.bulk.failure.rejected': 'Rejected — {message}',
  'hv.bulk.failure.storage': "Couldn't save — the integration failed to write to storage.",
  'hv.bulk.failure.fallback': 'Failed.',
  // What the progress line calls the batch it is running.
  'hv.bulk.label.move': 'Move',
  'hv.bulk.label.addTags': 'Tagging',
  'hv.bulk.label.removeTags': 'Untagging',
  'hv.bulk.label.setCategory': 'Categorising',
  'hv.bulk.label.adjustQty': 'Adjusting',
  'hv.bulk.label.checkOut': 'Checking out',
  'hv.bulk.label.checkIn': 'Checking in',
  'hv.bulk.label.delete': 'Delete',

  // hv-full-view.
  'hv.fullView.tagsAnyTitle': 'Items with any of the selected tags',
  'hv.fullView.tagsAllTitle': 'Items with all of them',
  'hv.fullView.newStatus': 'New status…',
  'hv.fullView.newTag': 'New tag…',
  'hv.fullView.newCategory': 'New category…',
  'hv.fullView.noTagsYet': 'No tags in use yet',
  'hv.fullView.noCategoriesYet': 'No categories in use yet',
  'hv.fullView.newLocation': 'New location',
  'hv.fullView.newLocationName': 'New location name',
  'hv.fullView.chooseColumns': 'Choose columns',
  'hv.fullView.exitSelection': 'Exit selection',
  'hv.fullView.selectedCount': '{count} selected',
  'hv.fullView.ofMatching': 'of {total} matching the current filter',
  'hv.fullView.loading': 'Loading…',
  'hv.fullView.loadAll': 'Load all {total} to select',
  'hv.fullView.clearSelection': 'Clear selection',
  'hv.fullView.openMenu': 'Open the Home Assistant menu',
  'hv.fullView.menu': 'Menu',
  'hv.fullView.close': 'Close full view',
  'hv.fullView.selectionHonesty':
    '{loaded} of {total} loaded · scroll to load more. Select-all covers loaded rows only.',
  'hv.fullView.scrollToLoadMore': ' · scroll to load more',
  'hv.fullView.deleteHeading': 'Delete {items}?',
  'hv.fullView.deleteMessage':
    'This cannot be undone. Items are removed for every connected client. Locations and tags are not affected.',
  'hv.fullView.deleteConfirm': 'Delete {count}',

  // hv-diagnostics-panel.
  'hv.diagnostics.title': 'Diagnostics',
  'hv.diagnostics.refreshing': 'Refreshing…',
  'hv.diagnostics.notLive': 'Not live',
  'hv.diagnostics.notLiveDetail':
    ' — subscriptions are down, so the list only changes when you refresh.',
  'hv.diagnostics.noIssues': 'No issues',
  'hv.diagnostics.noIssuesDetail': ' · live',
  'hv.diagnostics.sinceLastRefresh': 'Since last refresh',
  'hv.diagnostics.subscriptions': 'Subscriptions',
  'hv.diagnostics.subscriptionsLive': 'items · locations · stats — live',
  'hv.diagnostics.subscriptionsDown': 'not connected',
  'hv.diagnostics.dataLoaded': 'Data loaded',
  'hv.diagnostics.loadedValue': '{loaded} of {items} · {locations}',
  'hv.diagnostics.unknownItems': '? items',
  'hv.diagnostics.unknownLocations': '? locations',
  'hv.diagnostics.integrationVersion': 'Integration version',
  'hv.diagnostics.healthyNote': 'A healthy integration reports nothing here.',
  'hv.diagnostics.copyReport': 'Copy report',

  // hv-import-sheet.
  'hv.import.title': 'Import backup',
  'hv.import.step1': 'Step 1 of 2 · nothing is written until you press Import',
  'hv.import.pasteJson': 'Paste JSON',
  'hv.import.chooseFileTab': 'Choose file',
  'hv.import.chooseFile': 'Choose file…',
  'hv.import.noFileChosen': 'No file chosen',
  'hv.import.textareaLabel': 'Backup JSON',
  // The parser's own words are appended, and stay in the language the
  // browser wrote them in — they name a character and a position, which is
  // what a reader fixing the file needs, and nothing here can translate them.
  'hv.import.invalidJson': 'That is not valid JSON — {message}',
  'hv.import.ifExists': 'If an item already exists',
  'hv.import.policy.merge': 'Merge',
  'hv.import.policy.mergeDescription':
    'Update items matched by id field by field, combining tags; add the rest',
  'hv.import.policy.replace': 'Replace',
  'hv.import.policy.replaceDescription':
    "Overwrite items matched by id with the file's version; add the rest",
  'hv.import.policy.skip': 'Skip',
  'hv.import.policy.skipDescription':
    "Only add items whose id isn't in the inventory yet; leave matched items as they are",
  'hv.import.appliesEverywhere': 'Import applies for every connected client',
  'hv.import.checking': 'Checking…',
  'hv.import.preview': 'Preview',
  'hv.import.invalidTitle': "This file can't be imported",
  'hv.import.invalidSub': '{problems} found · nothing was changed',
  'hv.import.fixAndRetry': 'Fix the file and preview again',
  'hv.import.copyErrors': 'Copy errors',
  'hv.import.backToInput': 'Back to input',
  'hv.import.previewTitle': 'Import backup · preview',
  'hv.import.step2': 'Step 2 of 2 · validated on the server, nothing written yet · policy',
  'hv.import.tableItems': 'Items',
  'hv.import.bucket.add': 'Add',
  'hv.import.bucket.update': 'Update',
  'hv.import.bucket.conflict': 'Conflict',
  'hv.import.bucket.unchanged': 'Unchanged',
  'hv.import.conflicts.one': '{conflicts} — the file and this inventory both changed that entry.',
  'hv.import.conflicts.other': '{conflicts} — the file and this inventory both changed those entries.',
  'hv.import.conflictsMerge': "Merge keeps the file's values.",
  'hv.import.conflictsSkip': 'Skip leaves them as they are.',
  'hv.import.conflictsReplace': 'Replace overwrites them.',
  'hv.import.warnings.one':
    '{clashes} — the file would add an entry under a name something here already uses, under a different id. Import matches on the id alone, so this becomes a duplicate rather than an update.',
  'hv.import.warnings.other':
    '{clashes} — the file would add entries under a name something here already uses, under a different id. Import matches on the id alone, so these become duplicates rather than an update.',
  'hv.import.warningsMore': '…and {count} more.',
  'hv.import.attachmentsMissing.one':
    '{missing} of {referenced} attachments names a file this install does not have — that photo or manual will show as missing after the import.',
  'hv.import.attachmentsMissing.other':
    '{missing} of {referenced} attachments name files this install does not have — those photos and manuals will show as missing after the import.',
  'hv.import.attachmentsMissingHint': 'A Home Assistant backup carries the files as well.',
  'hv.import.allOrNothing':
    'Import is all-or-nothing: any failure rolls the whole document back. On success every connected card reloads its data.',
  'hv.import.importing': 'Importing…',
  'hv.import.button': 'Import {parts}',
  'hv.import.buttonBare': 'Import',
  'hv.import.nothingToDo': 'Nothing in this file would change the inventory',
  'hv.import.completeTitle': 'Import complete',
  'hv.import.nothingChanged': 'Nothing needed changing — the inventory already matched the file.',
  'hv.import.added': 'added {what}',
  'hv.import.updated': 'updated {what}',
  'hv.import.and': ' and ',
  'hv.import.holdsNow': 'The inventory now holds {items} across {locations}. Every connected card has reloaded.',

  // hv-organize-dialog.
  'hv.organize.title': 'Organize',
  'hv.organize.noun.tag': 'tag',
  'hv.organize.noun.category': 'category',
  'hv.organize.plural.tags': 'tags',
  'hv.organize.plural.categories': 'categories',
  'hv.organize.filterLocations': 'Filter locations',
  'hv.organize.filterLocationsPlaceholder': 'Filter locations…',
  'hv.organize.filterValues': 'Filter {values}',
  'hv.organize.filterValuesPlaceholder': 'Filter {values}…',
  'hv.organize.newStatus': 'New status',
  'hv.organize.newValue': 'New {noun}',
  'hv.organize.newValuePlaceholder': 'New {noun}…',
  'hv.organize.valueNeedsName': 'A {noun} needs a name.',
  'hv.organize.valueExists': '"{name}" already exists.',
  'hv.organize.draftNote': 'A {noun} exists through the items using it — there is nothing to create on the server. This one is kept on the card and offered while editing items, until an item takes it.',
  'hv.organize.draftBadge': 'new · not saved until an item uses it',
  'hv.organize.noValuesMatch': 'No {values} match',
  'hv.organize.noValuesYet': 'No {values} in use yet',
  'hv.organize.showItems': 'Show {items}',
  'hv.organize.renameEllipsis': 'Rename…',
  'hv.organize.editEllipsis': 'Edit…',
  'hv.organize.mergeIntoEllipsis': 'Merge into…',
  'hv.organize.mergeIntoPlaceholder': 'merge into…',
  'hv.organize.newNamePlaceholder': 'new name…',
  'hv.organize.mergeInto': 'Merge into',
  'hv.organize.newName': 'New name',
  'hv.organize.pickNameToContinue': 'Pick a name to continue.',
  'hv.organize.renameValue': 'Rename {value}',
  'hv.organize.mergeValue': 'Merge {value}',
  'hv.organize.mergeIntoAnother': 'Merge into another',
  'hv.organize.removeValue': 'Remove {value}',
  'hv.organize.removeFromEveryItem': 'Remove from every item',
  'hv.organize.removeFromAllItems': 'Remove from all items',
  'hv.organize.discardValue': 'Discard {value}',
  'hv.organize.actionsFor': 'Actions for {value}',
  'hv.organize.removeHeading': 'Remove "{value}" from {items}?',
  'hv.organize.removeMessage':
    'The value is cleared on every item that carries it. The items themselves are not deleted.',
  'hv.organize.locationNeedsName': 'A location needs a name.',
  'hv.organize.locationSaveFailed': 'Could not save that location.',
  'hv.organize.locationDeleteFailed': 'Could not delete that location.',
  'hv.organize.locationStillHolds': '"{name}" still contains {contents}. Move or delete them first.',
  'hv.organize.locationReadFailed': 'Could not read that location’s items.',
  'hv.organize.mergeKeptSource': '"{name}" was kept: {items} could not be moved.',
  'hv.organize.mergeMovedNotRemoved': 'Moved the items, but "{name}" could not be removed.',
  'hv.organize.locationArea': 'Area (HA)',
  'hv.organize.areaInherit': 'Inherit from location tree',
  'hv.organize.parentLocation': 'Parent location',
  'hv.organize.parentLocationNote': '(moves whole subtree)',
  'hv.organize.topLevel': 'Top level',
  'hv.organize.topLevelIn': 'Top level · {area}',
  'hv.organize.areaAssignTree': 'Assigns {chip} to the whole {root} tree, {size}.',
  'hv.organize.areaStoredOnRoot': ' The area is stored on {root}, not on this one.',
  'hv.organize.areaAssignOne': 'Assigns {chip} to this location.',
  'hv.organize.areaClearTree': 'Removes the area from the whole {root} tree, {size}.',
  'hv.organize.areaClearOne': 'Removes the area from this location.',
  'hv.organize.areaInherited': 'Inherits {chip} from its location tree.',
  'hv.organize.mergeEffect':
    '{contents} move to "{target}", then "{source}" is deleted. Items in sub-locations stay where they are; their paths just change.',
  'hv.organize.mergePickLocation': 'Pick a location to continue.',
  'hv.organize.mergeAreasNote':
    ' Areas group location trees and hold no items themselves, so the contents need a location to go to — to move this one into an area instead, edit it and pick the area as its parent.',
  'hv.organize.statusSaveFailed': 'Could not save that status.',
  'hv.organize.statusReorderFailed': 'Could not reorder.',
  'hv.organize.statusDeleteFailed': 'Could not delete that status.',
  'hv.organize.statusMoveUp': 'Move {label} up',
  'hv.organize.statusMoveDown': 'Move {label} down',
  'hv.organize.statusDefault': 'Default',
  'hv.organize.statusEdit': 'Edit {label}',
  'hv.organize.statusDelete': 'Delete {label}',
  'hv.organize.statusName': 'Status name',
  'hv.organize.statusNamePlaceholder': 'Status name…',
  'hv.organize.statusDuplicate': 'A status called “{label}” already exists.',
  'hv.organize.colour': 'Colour',
  'hv.organize.customColour': 'Custom colour',
  'hv.organize.customColourHint':
    '{hex} is used exactly as entered, so this chip looks the same in every Home Assistant theme — unlike the ten colours beside it, which follow the theme. The text on it is black or white, whichever reads better.',
  'hv.organize.icon': 'Icon',
  'hv.organize.statusInUse': '“{label}” is on {items}. Choose where those items go.',
  'hv.organize.statusUnused': 'Delete “{label}”? No item carries this status, so nothing else changes.',
  'hv.organize.moveThoseItemsTo': 'Move those items to',
  'hv.organize.reassignAndDelete': 'Reassign and delete',
  'hv.organize.rewriteNote':
    'Sent as one batch call · already-rewritten items keep the new value, so cancelling or a failure part-way is not undone.',
  'hv.organize.rewriteFailure': '{itemId} — {reason}',
  'hv.organize.rewrite.running.merge': 'Merge {done} of {total}',
  'hv.organize.rewrite.running.rename': 'Rename {done} of {total}',
  'hv.organize.rewrite.running.remove': 'Remove {done} of {total}',
  'hv.organize.rewrite.nothing.merge': 'Nothing to merge.',
  'hv.organize.rewrite.nothing.rename': 'Nothing to rename.',
  'hv.organize.rewrite.nothing.remove': 'Nothing to remove.',
  'hv.organize.rewrite.partial.merge': 'Merged {done} of {total}',
  'hv.organize.rewrite.partial.rename': 'Renamed {done} of {total}',
  'hv.organize.rewrite.partial.remove': 'Removed from {done} of {total}',
  'hv.organize.rewrite.done.merge': 'Merged {total}',
  'hv.organize.rewrite.done.rename': 'Renamed {total}',
  'hv.organize.rewrite.done.remove': 'Removed from {total}',
} as const;

/** Every string the card can say, as a type. */
export type TranslationKey = keyof typeof en;

/**
 * The base of a counted string — everything `tn` may be called with.
 *
 * Read off `.other` rather than `.one`, because `.other` is the form every
 * dictionary carries: it is what `tn` falls back to for a category the
 * language writes no separate form for.
 */
export type PluralKey = {
  [K in TranslationKey]: K extends `${infer Base}.other` ? Base : never;
}[TranslationKey];

/**
 * One counted form: a base and the plural category it answers for.
 *
 * The categories are `Intl.PluralRules`', not this file's — English writes two
 * of them, Polish needs `few` and `many`, and a dictionary that could only
 * carry the English pair could not spell Polish at all.
 */
export type PluralForm = `${PluralKey}.${Intl.LDMLPluralRule}`;

/**
 * A dictionary for one language.
 *
 * Partial on purpose: a community dictionary is incomplete on the day it
 * arrives, and `t` falls through to English for whatever it has not reached
 * yet. Wider than the English key universe by the plural forms, so a language
 * with more categories than English has somewhere to put them.
 */
export type Dictionary = Partial<Record<TranslationKey | PluralForm, string>>;

/**
 * A dictionary that answers every key.
 *
 * What a language is typed as once it is finished: every string English has,
 * and for a counted one at least `.other`, with the remaining categories
 * offered rather than demanded — German writes no `.one` for a noun it does
 * not inflect. This is what makes TypeScript itself refuse a translation left
 * behind by a new English string.
 */
export type CompleteDictionary = Record<Exclude<TranslationKey, PluralForm>, string> &
  Record<`${PluralKey}.other`, string> &
  Partial<Record<PluralForm, string>>;
