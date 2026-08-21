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
 * - A counted string is a pair, `<key>.one` and `<key>.other`, reached through
 *   `tn(key, count)`; `{count}` is passed in for both forms. A form may leave
 *   the number out — German writes "täglich" where English writes "every day".
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
  'hv.empty.noMatches.clearAction': 'Clear all',
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
  'hv.empty.noItems.importAction': 'Import backup',

  // ui/banners — the two stacks that say something is wrong.
  'hv.banner.connectionLost.heading': 'Connection lost',
  'hv.banner.connectionLost.message': ' · showing the data already loaded. Changes may not save.',
  'hv.banner.connectionLost.action': 'Reconnect',
  'hv.banner.liveUpdates.heading': 'Live updates paused',
  'hv.banner.liveUpdates.cause.unavailable': 'HAventory is not available',
  'hv.banner.liveUpdates.cause.rateLimited': 'rate limited',
  'hv.banner.liveUpdates.retrying':
    ' · {cause}. Retrying automatically; this list may be out of date until then.',
  'hv.banner.liveUpdates.stalled': ' · {cause}. This list may be out of date until you refresh.',
  'hv.banner.retrying.heading': 'Busy — retrying',
  'hv.banner.retrying.message.one': ' · {count} change queued',
  'hv.banner.retrying.message.other': ' · {count} changes queued',
  'hv.banner.rateLimited.heading': 'Rate limited',
  'hv.banner.rateLimited.message':
    ' · some live updates may have been dropped, so this list can be out of date.',
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

  // ui/health-codes — `haventory/health` issue codes, said in words. Counted,
  // because the backend repeats a code once per offending entity.
  'hv.health.itemIdKeyMismatch.one':
    '{count} item is stored under a key that does not match its id.',
  'hv.health.itemIdKeyMismatch.other':
    '{count} items are stored under a key that does not match their id.',
  'hv.health.itemReferencesMissingLocation.one':
    '{count} item references a location that no longer exists — it appears under "No location".',
  'hv.health.itemReferencesMissingLocation.other':
    '{count} items reference a location that no longer exists — they appear under "No location".',
  'hv.health.itemMissingFromLocationIndex.one': '{count} item is missing from the location index.',
  'hv.health.itemMissingFromLocationIndex.other':
    '{count} items are missing from the location index.',
  'hv.health.checkedOutItemMissingFromIndex.one':
    '{count} checked-out item is missing from the checked-out index.',
  'hv.health.checkedOutItemMissingFromIndex.other':
    '{count} checked-out items are missing from the checked-out index.',
  'hv.health.nonCheckedOutItemInIndex.one':
    '{count} item is in the checked-out index but is not checked out.',
  'hv.health.nonCheckedOutItemInIndex.other':
    '{count} items are in the checked-out index but are not checked out.',
  'hv.health.lowStockItemMissingFromIndex.one':
    '{count} low-stock item is missing from the low-stock index.',
  'hv.health.lowStockItemMissingFromIndex.other':
    '{count} low-stock items are missing from the low-stock index.',
  'hv.health.nonLowStockItemInIndex.one':
    '{count} item is in the low-stock index but is not low on stock.',
  'hv.health.nonLowStockItemInIndex.other':
    '{count} items are in the low-stock index but are not low on stock.',
  'hv.health.tagsIndexUnknownItems.one': 'The tag index references {count} item that no longer exists.',
  'hv.health.tagsIndexUnknownItems.other':
    'The tag index references {count} items that no longer exist.',
  'hv.health.categoryIndexUnknownItems.one':
    'The category index references {count} item that no longer exists.',
  'hv.health.categoryIndexUnknownItems.other':
    'The category index references {count} items that no longer exist.',
  'hv.health.checkedOutIndexUnknownItems.one':
    'The checked-out index references {count} item that no longer exists.',
  'hv.health.checkedOutIndexUnknownItems.other':
    'The checked-out index references {count} items that no longer exist.',
  'hv.health.lowStockIndexUnknownItems.one':
    'The low-stock index references {count} item that no longer exists.',
  'hv.health.lowStockIndexUnknownItems.other':
    'The low-stock index references {count} items that no longer exist.',
  'hv.health.locationIndexUnknownItems.one':
    'The location index references {count} item that no longer exists.',
  'hv.health.locationIndexUnknownItems.other':
    'The location index references {count} items that no longer exist.',
  'hv.health.locationIndexMissingLocation.one':
    'The location index has {count} bucket for a missing location.',
  'hv.health.locationIndexMissingLocation.other':
    'The location index has {count} buckets for missing locations.',
  'hv.health.locationBucketMismatch.one':
    '{count} location bucket disagrees with the items it holds.',
  'hv.health.locationBucketMismatch.other':
    '{count} location buckets disagree with the items they hold.',
  'hv.health.locationIdKeyMismatch.one':
    '{count} location is stored under a key that does not match its id.',
  'hv.health.locationIdKeyMismatch.other':
    '{count} locations are stored under a key that does not match their id.',
  // Four whole-store tallies. One entity each, so both forms say the same thing.
  'hv.health.itemsTotalMismatch.one': 'The cached item total disagrees with the stored items.',
  'hv.health.itemsTotalMismatch.other': 'The cached item total disagrees with the stored items.',
  'hv.health.locationsTotalMismatch.one':
    'The cached location total disagrees with the stored locations.',
  'hv.health.locationsTotalMismatch.other':
    'The cached location total disagrees with the stored locations.',
  'hv.health.checkedOutCountMismatch.one':
    'The cached checked-out count disagrees with the stored items.',
  'hv.health.checkedOutCountMismatch.other':
    'The cached checked-out count disagrees with the stored items.',
  'hv.health.lowStockCountMismatch.one':
    'The cached low-stock count disagrees with the stored items.',
  'hv.health.lowStockCountMismatch.other':
    'The cached low-stock count disagrees with the stored items.',

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
  'hv.count.issue.one': '{count} issue',
  'hv.count.issue.other': '{count} issues',
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

  // Three counted sentences whose components are translated in a later batch;
  // they land here because `ui/plural` no longer derives an English plural for
  // anyone, and these were its last three callers outside `src/ui`.
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
  'hv.action.confirm': 'Confirm',
  'hv.action.delete': 'Delete',
  'hv.action.remove': 'Remove',
  'hv.action.back': 'Back',
  'hv.action.open': 'Open',
  'hv.action.repeat': 'Retry',
  'hv.action.clearAll': 'Clear all',
  'hv.action.deleteItem': 'Delete item',
  'hv.action.checkIn': 'Check in',
  'hv.action.checkOut': 'Check out',
  'hv.action.checkOutEllipsis': 'Check out…',

  // Words the card names a fact with, wherever it names one.
  'hv.term.noLocation': 'No location',
  'hv.term.checkedOut': 'Checked out',
  'hv.term.overdue': 'Overdue',
  'hv.term.inspectionDue': 'Inspection due',
  'hv.term.low': 'Low',
  'hv.term.lowStock': 'Low stock',
  'hv.term.notSet': 'Not set',
  'hv.term.yes': 'Yes',
  'hv.term.no': 'No',
  'hv.term.fileMissing': 'File missing',
  'hv.term.due': 'due {date}',
  'hv.term.overdueOn': 'Overdue · {date}',
  'hv.term.checkedOutUntil': 'Checked out · due {date}',
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
  'hv.card.newItem': 'New item',
  'hv.card.notConnected': 'Not connected to Home Assistant yet.',

  // hv-list — the one row the list draws that is not an item.
  'hv.list.noLongerMatches': 'No longer matches the current filters',

  // hv-list-row.
  'hv.row.label': 'Item {name}',
  'hv.row.select': 'Select {name}',
  'hv.row.hasDocument': 'Has a document',
  'hv.row.pending': 'Pending',
  'hv.row.decreaseQuantity': 'Decrease quantity',
  'hv.row.increaseQuantity': 'Increase quantity',
  'hv.row.editItem': 'Edit item',
  'hv.row.editNamed': 'Edit {name}',
  'hv.row.actionsFor': 'Actions for {name}',
  'hv.row.menu.changeDueDate': 'Change due date…',
  'hv.row.menu.setDueDate': 'Set due date…',

  // hv-detail-sheet.
  'hv.sheet.label': 'Item',
  'hv.sheet.documents': 'Documents',
  'hv.sheet.documentAdded': 'added {when}',
  'hv.sheet.openPhoto': 'Open {photo}',
  'hv.sheet.lowStockAt': 'low-stock at {threshold}',
  'hv.sheet.fact.due': 'Due',
  'hv.sheet.fact.nextInspection': 'Next inspection',
  'hv.sheet.fact.reminder': 'Reminder',
  'hv.sheet.fact.updated': 'Updated',
  'hv.sheet.updatedValue': '{when} · v{version}',
  'hv.sheet.markDone': 'Mark done',
  'hv.sheet.markDoneTitle': 'Mark this reminder done and move it to its next occurrence',
  'hv.sheet.editDetails': 'Edit details',
  'hv.sheet.editItem': 'Edit item',

  // hv-item-editor.
  'hv.editor.heading.new': 'New item',
  'hv.editor.heading.editing': '{name} — editing',
  'hv.editor.version': 'v{version} · updated {when}',
  'hv.editor.close': 'Close editor',
  'hv.editor.field.name': 'Name',
  'hv.editor.field.quantity': 'Quantity',
  'hv.editor.field.lowStock': 'Low-stock at',
  'hv.editor.field.description': 'Description',
  'hv.editor.field.status': 'Status',
  'hv.editor.field.location': 'Location',
  'hv.editor.field.category': 'Category',
  'hv.editor.field.tags': 'Tags',
  'hv.editor.field.tagsNote': '· always lowercase',
  'hv.editor.categoryPlaceholder': 'No category',
  'hv.editor.showAllCategories': 'Show all categories',
  'hv.editor.categoryEmpty': 'No existing category matches “{typed}” — saving adds it as a new one.',
  'hv.editor.locationCreateFailed': 'The location could not be created.',
  'hv.editor.checkOutCaption': 'Check out',
  'hv.editor.dueDate': 'Due date',
  'hv.editor.dueDateHint': 'A due date applies while the item is checked out.',
  'hv.editor.thisItem': 'this item',
  'hv.editor.nextInspection': 'Next inspection',
  'hv.editor.reminder': 'Reminder',
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
  'hv.editor.documents': 'Documents',
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
  'hv.editor.moreFields': 'More fields',
  'hv.editor.moreSummaryFallback': 'description · dates · custom fields',
  'hv.editor.summary.description': 'description',
  'hv.editor.summary.dates': 'dates',
  'hv.editor.summary.reminder': 'reminder',
  'hv.editor.summary.custom': '{count} custom',
  'hv.editor.keyHint': 'Esc closes · {chord} saves',

  // hv-checkout-popover.
  'hv.checkout.setDueDate': 'Set due date',
  'hv.checkout.setADueDate': 'Set a due date',
  'hv.checkout.checkOutNamed': 'Check out {name}',
  'hv.checkout.sub': "A due date is optional — it's what makes overdue highlighting work.",
  'hv.checkout.noDueDate': 'No due date',
  'hv.checkout.clearDueDate': 'Clear due date',
  'hv.checkout.withoutDueDate': 'Check out with no due date',
  'hv.checkout.set': 'Set',
  'hv.checkout.confirmWithDate': '{action} · due {date}',

  // hv-location-tree.
  'hv.tree.label': 'Locations',
  'hv.tree.allItems': 'All items',
  'hv.tree.noArea': 'No area',
  'hv.tree.noneMatch': 'No locations match',
  'hv.tree.noneYet': 'No locations yet',
  'hv.tree.newLocation': 'New location…',
  'hv.tree.newLocationName': 'New location name',
  'hv.tree.locationNamePlaceholder': 'Location name',
  'hv.tree.collapse': 'Collapse {name}',
  'hv.tree.expand': 'Expand {name}',
  'hv.tree.actionsFor': 'Actions for {name}',
  'hv.tree.merge': 'Merge {name}',
  'hv.tree.mergeTitle': 'Merge into another location',
  'hv.tree.edit': 'Edit {name}',
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
  'hv.surfaces.menu.diagnostics': 'Diagnostics',
  'hv.surfaces.menu.data': 'Data',
  'hv.surfaces.menu.exportAll': 'Export backup',
  'hv.surfaces.menu.exportAllSub': 'Everything',
  'hv.surfaces.menu.exportAllCount.one': 'All {count} item · All locations',
  'hv.surfaces.menu.exportAllCount.other': 'All {count} items · All locations',
  'hv.surfaces.menu.exportView': 'Export current view',
  'hv.surfaces.menu.exportViewSub': 'Active filter · Keeps location paths',
  'hv.surfaces.menu.import': 'Import backup…',
  'hv.surfaces.badge.dropped': '{count} dropped',
  'hv.surfaces.badge.offline': 'offline',
  'hv.surfaces.columnsHeading': 'Full view columns',
  'hv.surfaces.importCheckFailed': 'Could not check that document.',
  'hv.surfaces.importFailed': 'The import failed.',

  // haventory-card-editor — the one field Home Assistant's card editor shows.
  'hv.cardEditor.title': 'Title',
} as const;

/** Every string the card can say, as a type. */
export type TranslationKey = keyof typeof en;

/**
 * A dictionary for one language.
 *
 * Partial on purpose: a community dictionary is incomplete on the day it
 * arrives, and `t` falls through to English for whatever it has not reached
 * yet. `de` is declared complete separately, which is what makes TypeScript
 * itself refuse a German string left behind by a new English one.
 */
export type Dictionary = Partial<Record<TranslationKey, string>>;

/** The base of a counted pair — everything `tn` may be called with. */
export type PluralKey = {
  [K in TranslationKey]: K extends `${infer Base}.one` ? Base : never;
}[TranslationKey];
