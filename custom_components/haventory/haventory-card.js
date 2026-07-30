//#region node_modules/@lit/reactive-element/css-tag.js
var e = globalThis, t = e.ShadowRoot && (e.ShadyCSS === void 0 || e.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype, n = Symbol(), r = /* @__PURE__ */ new WeakMap(), i = class {
	constructor(e, t, r) {
		if (this._$cssResult$ = !0, r !== n) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
		this.cssText = e, this.t = t;
	}
	get styleSheet() {
		let e = this.o, n = this.t;
		if (t && e === void 0) {
			let t = n !== void 0 && n.length === 1;
			t && (e = r.get(n)), e === void 0 && ((this.o = e = new CSSStyleSheet()).replaceSync(this.cssText), t && r.set(n, e));
		}
		return e;
	}
	toString() {
		return this.cssText;
	}
}, a = (e) => new i(typeof e == "string" ? e : e + "", void 0, n), o = (e, ...t) => new i(e.length === 1 ? e[0] : t.reduce((t, n, r) => t + ((e) => {
	if (!0 === e._$cssResult$) return e.cssText;
	if (typeof e == "number") return e;
	throw Error("Value passed to 'css' function must be a 'css' function result: " + e + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
})(n) + e[r + 1], e[0]), e, n), s = (n, r) => {
	if (t) n.adoptedStyleSheets = r.map((e) => e instanceof CSSStyleSheet ? e : e.styleSheet);
	else for (let t of r) {
		let r = document.createElement("style"), i = e.litNonce;
		i !== void 0 && r.setAttribute("nonce", i), r.textContent = t.cssText, n.appendChild(r);
	}
}, c = t ? (e) => e : (e) => e instanceof CSSStyleSheet ? ((e) => {
	let t = "";
	for (let n of e.cssRules) t += n.cssText;
	return a(t);
})(e) : e, l, { is: u, defineProperty: d, getOwnPropertyDescriptor: f, getOwnPropertyNames: p, getOwnPropertySymbols: m, getPrototypeOf: ee } = Object, te = globalThis, ne = te.trustedTypes, re = ne ? ne.emptyScript : "", ie = te.reactiveElementPolyfillSupport, ae = (e, t) => e, oe = {
	toAttribute(e, t) {
		switch (t) {
			case Boolean:
				e = e ? re : null;
				break;
			case Object:
			case Array: e = e == null ? e : JSON.stringify(e);
		}
		return e;
	},
	fromAttribute(e, t) {
		let n = e;
		switch (t) {
			case Boolean:
				n = e !== null;
				break;
			case Number:
				n = e === null ? null : Number(e);
				break;
			case Object:
			case Array: try {
				n = JSON.parse(e);
			} catch {
				n = null;
			}
		}
		return n;
	}
}, se = (e, t) => !u(e, t), ce = {
	attribute: !0,
	type: String,
	converter: oe,
	reflect: !1,
	useDefault: !1,
	hasChanged: se
};
(l = Symbol).metadata ?? (l.metadata = Symbol("metadata")), te.litPropertyMetadata ?? (te.litPropertyMetadata = /* @__PURE__ */ new WeakMap());
var le = class extends HTMLElement {
	static addInitializer(e) {
		this._$Ei(), (this.l ?? (this.l = [])).push(e);
	}
	static get observedAttributes() {
		return this.finalize(), this._$Eh && [...this._$Eh.keys()];
	}
	static createProperty(e, t = ce) {
		if (t.state && (t.attribute = !1), this._$Ei(), this.prototype.hasOwnProperty(e) && ((t = Object.create(t)).wrapped = !0), this.elementProperties.set(e, t), !t.noAccessor) {
			let n = Symbol(), r = this.getPropertyDescriptor(e, n, t);
			r !== void 0 && d(this.prototype, e, r);
		}
	}
	static getPropertyDescriptor(e, t, n) {
		let { get: r, set: i } = f(this.prototype, e) ?? {
			get() {
				return this[t];
			},
			set(e) {
				this[t] = e;
			}
		};
		return {
			get: r,
			set(t) {
				let a = r?.call(this);
				i?.call(this, t), this.requestUpdate(e, a, n);
			},
			configurable: !0,
			enumerable: !0
		};
	}
	static getPropertyOptions(e) {
		return this.elementProperties.get(e) ?? ce;
	}
	static _$Ei() {
		if (this.hasOwnProperty(ae("elementProperties"))) return;
		let e = ee(this);
		e.finalize(), e.l !== void 0 && (this.l = [...e.l]), this.elementProperties = new Map(e.elementProperties);
	}
	static finalize() {
		if (this.hasOwnProperty(ae("finalized"))) return;
		if (this.finalized = !0, this._$Ei(), this.hasOwnProperty(ae("properties"))) {
			let e = this.properties, t = [...p(e), ...m(e)];
			for (let n of t) this.createProperty(n, e[n]);
		}
		let e = this[Symbol.metadata];
		if (e !== null) {
			let t = litPropertyMetadata.get(e);
			if (t !== void 0) for (let [e, n] of t) this.elementProperties.set(e, n);
		}
		this._$Eh = /* @__PURE__ */ new Map();
		for (let [e, t] of this.elementProperties) {
			let n = this._$Eu(e, t);
			n !== void 0 && this._$Eh.set(n, e);
		}
		this.elementStyles = this.finalizeStyles(this.styles);
	}
	static finalizeStyles(e) {
		let t = [];
		if (Array.isArray(e)) {
			let n = new Set(e.flat(Infinity).reverse());
			for (let e of n) t.unshift(c(e));
		} else e !== void 0 && t.push(c(e));
		return t;
	}
	static _$Eu(e, t) {
		let n = t.attribute;
		return !1 === n ? void 0 : typeof n == "string" ? n : typeof e == "string" ? e.toLowerCase() : void 0;
	}
	constructor() {
		super(), this._$Ep = void 0, this.isUpdatePending = !1, this.hasUpdated = !1, this._$Em = null, this._$Ev();
	}
	_$Ev() {
		this._$ES = new Promise((e) => this.enableUpdating = e), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((e) => e(this));
	}
	addController(e) {
		(this._$EO ?? (this._$EO = /* @__PURE__ */ new Set())).add(e), this.renderRoot !== void 0 && this.isConnected && e.hostConnected?.();
	}
	removeController(e) {
		this._$EO?.delete(e);
	}
	_$E_() {
		let e = /* @__PURE__ */ new Map(), t = this.constructor.elementProperties;
		for (let n of t.keys()) this.hasOwnProperty(n) && (e.set(n, this[n]), delete this[n]);
		e.size > 0 && (this._$Ep = e);
	}
	createRenderRoot() {
		let e = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
		return s(e, this.constructor.elementStyles), e;
	}
	connectedCallback() {
		this.renderRoot ?? (this.renderRoot = this.createRenderRoot()), this.enableUpdating(!0), this._$EO?.forEach((e) => e.hostConnected?.());
	}
	enableUpdating(e) {}
	disconnectedCallback() {
		this._$EO?.forEach((e) => e.hostDisconnected?.());
	}
	attributeChangedCallback(e, t, n) {
		this._$AK(e, n);
	}
	_$ET(e, t) {
		let n = this.constructor.elementProperties.get(e), r = this.constructor._$Eu(e, n);
		if (r !== void 0 && !0 === n.reflect) {
			let i = (n.converter?.toAttribute === void 0 ? oe : n.converter).toAttribute(t, n.type);
			this._$Em = e, i == null ? this.removeAttribute(r) : this.setAttribute(r, i), this._$Em = null;
		}
	}
	_$AK(e, t) {
		let n = this.constructor, r = n._$Eh.get(e);
		if (r !== void 0 && this._$Em !== r) {
			let e = n.getPropertyOptions(r), i = typeof e.converter == "function" ? { fromAttribute: e.converter } : e.converter?.fromAttribute === void 0 ? oe : e.converter;
			this._$Em = r;
			let a = i.fromAttribute(t, e.type);
			this[r] = a ?? this._$Ej?.get(r) ?? a, this._$Em = null;
		}
	}
	requestUpdate(e, t, n, r = !1, i) {
		if (e !== void 0) {
			let a = this.constructor;
			if (!1 === r && (i = this[e]), n ?? (n = a.getPropertyOptions(e)), !((n.hasChanged ?? se)(i, t) || n.useDefault && n.reflect && i === this._$Ej?.get(e) && !this.hasAttribute(a._$Eu(e, n)))) return;
			this.C(e, t, n);
		}
		!1 === this.isUpdatePending && (this._$ES = this._$EP());
	}
	C(e, t, { useDefault: n, reflect: r, wrapped: i }, a) {
		n && !(this._$Ej ?? (this._$Ej = /* @__PURE__ */ new Map())).has(e) && (this._$Ej.set(e, a ?? t ?? this[e]), !0 !== i || a !== void 0) || (this._$AL.has(e) || (this.hasUpdated || n || (t = void 0), this._$AL.set(e, t)), !0 === r && this._$Em !== e && (this._$Eq ?? (this._$Eq = /* @__PURE__ */ new Set())).add(e));
	}
	async _$EP() {
		this.isUpdatePending = !0;
		try {
			await this._$ES;
		} catch (e) {
			Promise.reject(e);
		}
		let e = this.scheduleUpdate();
		return e != null && await e, !this.isUpdatePending;
	}
	scheduleUpdate() {
		return this.performUpdate();
	}
	performUpdate() {
		if (!this.isUpdatePending) return;
		if (!this.hasUpdated) {
			if (this.renderRoot ?? (this.renderRoot = this.createRenderRoot()), this._$Ep) {
				for (let [e, t] of this._$Ep) this[e] = t;
				this._$Ep = void 0;
			}
			let e = this.constructor.elementProperties;
			if (e.size > 0) for (let [t, n] of e) {
				let { wrapped: e } = n, r = this[t];
				!0 !== e || this._$AL.has(t) || r === void 0 || this.C(t, void 0, n, r);
			}
		}
		let e = !1, t = this._$AL;
		try {
			e = this.shouldUpdate(t), e ? (this.willUpdate(t), this._$EO?.forEach((e) => e.hostUpdate?.()), this.update(t)) : this._$EM();
		} catch (t) {
			throw e = !1, this._$EM(), t;
		}
		e && this._$AE(t);
	}
	willUpdate(e) {}
	_$AE(e) {
		this._$EO?.forEach((e) => e.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = !0, this.firstUpdated(e)), this.updated(e);
	}
	_$EM() {
		this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = !1;
	}
	get updateComplete() {
		return this.getUpdateComplete();
	}
	getUpdateComplete() {
		return this._$ES;
	}
	shouldUpdate(e) {
		return !0;
	}
	update(e) {
		this._$Eq && (this._$Eq = this._$Eq.forEach((e) => this._$ET(e, this[e]))), this._$EM();
	}
	updated(e) {}
	firstUpdated(e) {}
};
le.elementStyles = [], le.shadowRootOptions = { mode: "open" }, le[ae("elementProperties")] = /* @__PURE__ */ new Map(), le[ae("finalized")] = /* @__PURE__ */ new Map(), ie?.({ ReactiveElement: le }), (te.reactiveElementVersions ?? (te.reactiveElementVersions = [])).push("2.1.2");
//#endregion
//#region node_modules/lit-html/lit-html.js
var ue = globalThis, de = (e) => e, fe = ue.trustedTypes, pe = fe ? fe.createPolicy("lit-html", { createHTML: (e) => e }) : void 0, me = "$lit$", h = `lit$${Math.random().toFixed(9).slice(2)}$`, he = "?" + h, ge = `<${he}>`, g = document, _e = () => g.createComment(""), ve = (e) => e === null || typeof e != "object" && typeof e != "function", ye = Array.isArray, be = (e) => ye(e) || typeof e?.[Symbol.iterator] == "function", xe = "[ 	\n\f\r]", Se = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g, Ce = /-->/g, we = />/g, _ = RegExp(`>|${xe}(?:([^\\s"'>=/]+)(${xe}*=${xe}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`, "g"), Te = /'/g, Ee = /"/g, De = /^(?:script|style|textarea|title)$/i, Oe = (e) => (t, ...n) => ({
	_$litType$: e,
	strings: t,
	values: n
}), v = Oe(1), ke = Oe(2), Ae = Symbol.for("lit-noChange"), y = Symbol.for("lit-nothing"), je = /* @__PURE__ */ new WeakMap(), Me = g.createTreeWalker(g, 129);
function Ne(e, t) {
	if (!ye(e) || !e.hasOwnProperty("raw")) throw Error("invalid template strings array");
	return pe === void 0 ? t : pe.createHTML(t);
}
var Pe = (e, t) => {
	let n = e.length - 1, r = [], i, a = t === 2 ? "<svg>" : t === 3 ? "<math>" : "", o = Se;
	for (let t = 0; t < n; t++) {
		let n = e[t], s, c, l = -1, u = 0;
		for (; u < n.length && (o.lastIndex = u, c = o.exec(n), c !== null);) u = o.lastIndex, o === Se ? c[1] === "!--" ? o = Ce : c[1] === void 0 ? c[2] === void 0 ? c[3] !== void 0 && (o = _) : (De.test(c[2]) && (i = RegExp("</" + c[2], "g")), o = _) : o = we : o === _ ? c[0] === ">" ? (o = i ?? Se, l = -1) : c[1] === void 0 ? l = -2 : (l = o.lastIndex - c[2].length, s = c[1], o = c[3] === void 0 ? _ : c[3] === "\"" ? Ee : Te) : o === Ee || o === Te ? o = _ : o === Ce || o === we ? o = Se : (o = _, i = void 0);
		let d = o === _ && e[t + 1].startsWith("/>") ? " " : "";
		a += o === Se ? n + ge : l >= 0 ? (r.push(s), n.slice(0, l) + me + n.slice(l) + h + d) : n + h + (l === -2 ? t : d);
	}
	return [Ne(e, a + (e[n] || "<?>") + (t === 2 ? "</svg>" : t === 3 ? "</math>" : "")), r];
}, Fe = class e {
	constructor({ strings: t, _$litType$: n }, r) {
		let i;
		this.parts = [];
		let a = 0, o = 0, s = t.length - 1, c = this.parts, [l, u] = Pe(t, n);
		if (this.el = e.createElement(l, r), Me.currentNode = this.el.content, n === 2 || n === 3) {
			let e = this.el.content.firstChild;
			e.replaceWith(...e.childNodes);
		}
		for (; (i = Me.nextNode()) !== null && c.length < s;) {
			if (i.nodeType === 1) {
				if (i.hasAttributes()) for (let e of i.getAttributeNames()) if (e.endsWith(me)) {
					let t = u[o++], n = i.getAttribute(e).split(h), r = /([.?@])?(.*)/.exec(t);
					c.push({
						type: 1,
						index: a,
						name: r[2],
						strings: n,
						ctor: r[1] === "." ? Be : r[1] === "?" ? Ve : r[1] === "@" ? He : ze
					}), i.removeAttribute(e);
				} else e.startsWith(h) && (c.push({
					type: 6,
					index: a
				}), i.removeAttribute(e));
				if (De.test(i.tagName)) {
					let e = i.textContent.split(h), t = e.length - 1;
					if (t > 0) {
						i.textContent = fe ? fe.emptyScript : "";
						for (let n = 0; n < t; n++) i.append(e[n], _e()), Me.nextNode(), c.push({
							type: 2,
							index: ++a
						});
						i.append(e[t], _e());
					}
				}
			} else if (i.nodeType === 8) if (i.data === he) c.push({
				type: 2,
				index: a
			});
			else {
				let e = -1;
				for (; (e = i.data.indexOf(h, e + 1)) !== -1;) c.push({
					type: 7,
					index: a
				}), e += h.length - 1;
			}
			a++;
		}
	}
	static createElement(e, t) {
		let n = g.createElement("template");
		return n.innerHTML = e, n;
	}
};
function Ie(e, t, n = e, r) {
	if (t === Ae) return t;
	let i = r === void 0 ? n._$Cl : n._$Co?.[r], a = ve(t) ? void 0 : t._$litDirective$;
	return i?.constructor !== a && (i?._$AO?.(!1), a === void 0 ? i = void 0 : (i = new a(e), i._$AT(e, n, r)), r === void 0 ? n._$Cl = i : (n._$Co ?? (n._$Co = []))[r] = i), i !== void 0 && (t = Ie(e, i._$AS(e, t.values), i, r)), t;
}
var Le = class {
	constructor(e, t) {
		this._$AV = [], this._$AN = void 0, this._$AD = e, this._$AM = t;
	}
	get parentNode() {
		return this._$AM.parentNode;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	u(e) {
		let { el: { content: t }, parts: n } = this._$AD, r = (e?.creationScope ?? g).importNode(t, !0);
		Me.currentNode = r;
		let i = Me.nextNode(), a = 0, o = 0, s = n[0];
		for (; s !== void 0;) {
			if (a === s.index) {
				let t;
				s.type === 2 ? t = new Re(i, i.nextSibling, this, e) : s.type === 1 ? t = new s.ctor(i, s.name, s.strings, this, e) : s.type === 6 && (t = new Ue(i, this, e)), this._$AV.push(t), s = n[++o];
			}
			a !== s?.index && (i = Me.nextNode(), a++);
		}
		return Me.currentNode = g, r;
	}
	p(e) {
		let t = 0;
		for (let n of this._$AV) n !== void 0 && (n.strings === void 0 ? n._$AI(e[t]) : (n._$AI(e, n, t), t += n.strings.length - 2)), t++;
	}
}, Re = class e {
	get _$AU() {
		return this._$AM?._$AU ?? this._$Cv;
	}
	constructor(e, t, n, r) {
		this.type = 2, this._$AH = y, this._$AN = void 0, this._$AA = e, this._$AB = t, this._$AM = n, this.options = r, this._$Cv = r?.isConnected ?? !0;
	}
	get parentNode() {
		let e = this._$AA.parentNode, t = this._$AM;
		return t !== void 0 && e?.nodeType === 11 && (e = t.parentNode), e;
	}
	get startNode() {
		return this._$AA;
	}
	get endNode() {
		return this._$AB;
	}
	_$AI(e, t = this) {
		e = Ie(this, e, t), ve(e) ? e === y || e == null || e === "" ? (this._$AH !== y && this._$AR(), this._$AH = y) : e !== this._$AH && e !== Ae && this._(e) : e._$litType$ === void 0 ? e.nodeType === void 0 ? be(e) ? this.k(e) : this._(e) : this.T(e) : this.$(e);
	}
	O(e) {
		return this._$AA.parentNode.insertBefore(e, this._$AB);
	}
	T(e) {
		this._$AH !== e && (this._$AR(), this._$AH = this.O(e));
	}
	_(e) {
		this._$AH !== y && ve(this._$AH) ? this._$AA.nextSibling.data = e : this.T(g.createTextNode(e)), this._$AH = e;
	}
	$(e) {
		let { values: t, _$litType$: n } = e, r = typeof n == "number" ? this._$AC(e) : (n.el === void 0 && (n.el = Fe.createElement(Ne(n.h, n.h[0]), this.options)), n);
		if (this._$AH?._$AD === r) this._$AH.p(t);
		else {
			let e = new Le(r, this), n = e.u(this.options);
			e.p(t), this.T(n), this._$AH = e;
		}
	}
	_$AC(e) {
		let t = je.get(e.strings);
		return t === void 0 && je.set(e.strings, t = new Fe(e)), t;
	}
	k(t) {
		ye(this._$AH) || (this._$AH = [], this._$AR());
		let n = this._$AH, r, i = 0;
		for (let a of t) i === n.length ? n.push(r = new e(this.O(_e()), this.O(_e()), this, this.options)) : r = n[i], r._$AI(a), i++;
		i < n.length && (this._$AR(r && r._$AB.nextSibling, i), n.length = i);
	}
	_$AR(e = this._$AA.nextSibling, t) {
		for (this._$AP?.(!1, !0, t); e !== this._$AB;) {
			let t = de(e).nextSibling;
			de(e).remove(), e = t;
		}
	}
	setConnected(e) {
		this._$AM === void 0 && (this._$Cv = e, this._$AP?.(e));
	}
}, ze = class {
	get tagName() {
		return this.element.tagName;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	constructor(e, t, n, r, i) {
		this.type = 1, this._$AH = y, this._$AN = void 0, this.element = e, this.name = t, this._$AM = r, this.options = i, n.length > 2 || n[0] !== "" || n[1] !== "" ? (this._$AH = Array(n.length - 1).fill(/* @__PURE__ */ new String()), this.strings = n) : this._$AH = y;
	}
	_$AI(e, t = this, n, r) {
		let i = this.strings, a = !1;
		if (i === void 0) e = Ie(this, e, t, 0), a = !ve(e) || e !== this._$AH && e !== Ae, a && (this._$AH = e);
		else {
			let r = e, o, s;
			for (e = i[0], o = 0; o < i.length - 1; o++) s = Ie(this, r[n + o], t, o), s === Ae && (s = this._$AH[o]), a || (a = !ve(s) || s !== this._$AH[o]), s === y ? e = y : e !== y && (e += (s ?? "") + i[o + 1]), this._$AH[o] = s;
		}
		a && !r && this.j(e);
	}
	j(e) {
		e === y ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, e ?? "");
	}
}, Be = class extends ze {
	constructor() {
		super(...arguments), this.type = 3;
	}
	j(e) {
		this.element[this.name] = e === y ? void 0 : e;
	}
}, Ve = class extends ze {
	constructor() {
		super(...arguments), this.type = 4;
	}
	j(e) {
		this.element.toggleAttribute(this.name, !!e && e !== y);
	}
}, He = class extends ze {
	constructor(e, t, n, r, i) {
		super(e, t, n, r, i), this.type = 5;
	}
	_$AI(e, t = this) {
		if ((e = Ie(this, e, t, 0) ?? y) === Ae) return;
		let n = this._$AH, r = e === y && n !== y || e.capture !== n.capture || e.once !== n.once || e.passive !== n.passive, i = e !== y && (n === y || r);
		r && this.element.removeEventListener(this.name, this, n), i && this.element.addEventListener(this.name, this, e), this._$AH = e;
	}
	handleEvent(e) {
		typeof this._$AH == "function" ? this._$AH.call(this.options?.host ?? this.element, e) : this._$AH.handleEvent(e);
	}
}, Ue = class {
	constructor(e, t, n) {
		this.element = e, this.type = 6, this._$AN = void 0, this._$AM = t, this.options = n;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	_$AI(e) {
		Ie(this, e);
	}
}, We = {
	M: me,
	P: h,
	A: he,
	C: 1,
	L: Pe,
	R: Le,
	D: be,
	V: Ie,
	I: Re,
	H: ze,
	N: Ve,
	U: He,
	B: Be,
	F: Ue
}, Ge = ue.litHtmlPolyfillSupport;
Ge?.(Fe, Re), (ue.litHtmlVersions ?? (ue.litHtmlVersions = [])).push("3.3.3");
var Ke = (e, t, n) => {
	let r = n?.renderBefore ?? t, i = r._$litPart$;
	if (i === void 0) {
		let e = n?.renderBefore ?? null;
		r._$litPart$ = i = new Re(t.insertBefore(_e(), e), e, void 0, n ?? {});
	}
	return i._$AI(e), i;
}, qe = globalThis, b = class extends le {
	constructor() {
		super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
	}
	createRenderRoot() {
		var e;
		let t = super.createRenderRoot();
		return (e = this.renderOptions).renderBefore ?? (e.renderBefore = t.firstChild), t;
	}
	update(e) {
		let t = this.render();
		this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(e), this._$Do = Ke(t, this.renderRoot, this.renderOptions);
	}
	connectedCallback() {
		super.connectedCallback(), this._$Do?.setConnected(!0);
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._$Do?.setConnected(!1);
	}
	render() {
		return Ae;
	}
};
b._$litElement$ = !0, b.finalized = !0, qe.litElementHydrateSupport?.({ LitElement: b });
var Je = qe.litElementPolyfillSupport;
Je?.({ LitElement: b }), (qe.litElementVersions ?? (qe.litElementVersions = [])).push("4.2.2");
//#endregion
//#region src/store/ws.ts
var Ye = 1, Xe = class {
	constructor(e) {
		this.hass = e;
	}
	ping(e) {
		return this.hass.callWS({
			type: "haventory/ping",
			echo: e
		});
	}
	version() {
		return this.hass.callWS({ type: "haventory/version" });
	}
	stats() {
		return this.hass.callWS({ type: "haventory/stats" });
	}
	health() {
		return this.hass.callWS({ type: "haventory/health" });
	}
	distinctValues() {
		return this.hass.callWS({ type: "haventory/distinct_values" });
	}
	getItem(e) {
		return this.hass.callWS({
			type: "haventory/item/get",
			item_id: e
		});
	}
	listItems(e, t, n, r) {
		let i = { type: "haventory/item/list" };
		return e && (i.filter = e), t && (i.sort = t), typeof n == "number" && (i.limit = n), r && (i.cursor = r), this.hass.callWS(i);
	}
	createItem(e) {
		return this.hass.callWS({
			type: "haventory/item/create",
			...e
		});
	}
	updateItem(e, t, n) {
		let r = {
			type: "haventory/item/update",
			item_id: e,
			...t
		};
		return typeof n == "number" && (r.expected_version = n), this.hass.callWS(r);
	}
	deleteItem(e, t) {
		let n = {
			type: "haventory/item/delete",
			item_id: e
		};
		return typeof t == "number" && (n.expected_version = t), this.hass.callWS(n);
	}
	adjustQuantity(e, t, n) {
		let r = {
			type: "haventory/item/adjust_quantity",
			item_id: e,
			delta: t
		};
		return typeof n == "number" && (r.expected_version = n), this.hass.callWS(r);
	}
	setQuantity(e, t, n) {
		let r = {
			type: "haventory/item/set_quantity",
			item_id: e,
			quantity: t
		};
		return typeof n == "number" && (r.expected_version = n), this.hass.callWS(r);
	}
	checkOut(e, t, n) {
		let r = {
			type: "haventory/item/check_out",
			item_id: e
		};
		return t !== void 0 && (r.due_date = t), typeof n == "number" && (r.expected_version = n), this.hass.callWS(r);
	}
	markCheckedIn(e, t) {
		let n = {
			type: "haventory/item/check_in",
			item_id: e
		};
		return typeof t == "number" && (n.expected_version = t), this.hass.callWS(n);
	}
	setLowStockThreshold(e, t, n) {
		let r = {
			type: "haventory/item/set_low_stock_threshold",
			item_id: e,
			low_stock_threshold: t
		};
		return typeof n == "number" && (r.expected_version = n), this.hass.callWS(r);
	}
	moveItem(e, t, n) {
		let r = {
			type: "haventory/item/move",
			item_id: e,
			location_id: t
		};
		return typeof n == "number" && (r.expected_version = n), this.hass.callWS(r);
	}
	addTags(e, t, n) {
		let r = {
			type: "haventory/item/add_tags",
			item_id: e,
			tags: t
		};
		return typeof n == "number" && (r.expected_version = n), this.hass.callWS(r);
	}
	removeTags(e, t, n) {
		let r = {
			type: "haventory/item/remove_tags",
			item_id: e,
			tags: t
		};
		return typeof n == "number" && (r.expected_version = n), this.hass.callWS(r);
	}
	updateCustomFields(e, t, n, r) {
		let i = {
			type: "haventory/item/update_custom_fields",
			item_id: e
		};
		return t && (i.set = t), n && (i.unset = n), typeof r == "number" && (i.expected_version = r), this.hass.callWS(i);
	}
	bulk(e) {
		return this.hass.callWS({
			type: "haventory/items/bulk",
			operations: e
		});
	}
	listLocations() {
		return this.hass.callWS({ type: "haventory/location/list" });
	}
	createLocation(e, t, n) {
		let r = {
			type: "haventory/location/create",
			name: e
		};
		return t !== void 0 && (r.parent_id = t), n !== void 0 && (r.area_id = n), this.hass.callWS(r);
	}
	getLocation(e) {
		return this.hass.callWS({
			type: "haventory/location/get",
			location_id: e
		});
	}
	updateLocation(e, t) {
		let n = {
			type: "haventory/location/update",
			location_id: e
		};
		return t.name !== void 0 && (n.name = t.name), t.areaId !== void 0 && (n.area_id = t.areaId), t.newParentId !== void 0 && (n.new_parent_id = t.newParentId), this.hass.callWS(n);
	}
	deleteLocation(e) {
		return this.hass.callWS({
			type: "haventory/location/delete",
			location_id: e
		});
	}
	moveLocationSubtree(e, t) {
		return this.hass.callWS({
			type: "haventory/location/move_subtree",
			location_id: e,
			new_parent_id: t
		});
	}
	getLocationTree(e) {
		let t = { type: "haventory/location/tree" };
		return e && (t.filter = e), this.hass.callWS(t);
	}
	listAreas() {
		return this.hass.callWS({ type: "haventory/areas/list" });
	}
	exportDocument(e) {
		let t = { type: "haventory/export" };
		return e && (t.filter = e), this.hass.callWS(t);
	}
	importPreview(e, t) {
		return this.hass.callWS({
			type: "haventory/import/preview",
			document: e,
			policy: t
		});
	}
	importExecute(e, t) {
		return this.hass.callWS({
			type: "haventory/import/execute",
			document: e,
			policy: t
		});
	}
	subscribe(e, t, n) {
		let r = {
			id: Ye++,
			type: "haventory/subscribe",
			topic: e
		};
		n && "location_id" in n && (r.location_id = n.location_id ?? null), n && "include_subtree" in n && (r.include_subtree = !!n.include_subtree);
		let i = this.hass.connection.subscribeMessage((e) => {
			e && t(e);
		}, r);
		if (typeof i == "function") return n?.onOpen?.(), i;
		let a = null, o = !1;
		return Promise.resolve(i).then((e) => {
			if (a = e, o && a) {
				try {
					a();
				} catch {}
				return;
			}
			n?.onOpen?.();
		}, (e) => {
			n?.onError?.(e);
		}), () => {
			a ? a() : o = !0;
		};
	}
};
//#endregion
//#region src/store/sort.ts
function Ze(e) {
	return e === "name" || e === "quantity" || e === "due_date" || e === "inspection_date" ? "asc" : "desc";
}
var Qe = {
	field: "updated_at",
	order: "desc"
}, $e = new Intl.Collator(void 0, {
	sensitivity: "base",
	numeric: !0
});
function et(e) {
	return [...e].sort((e, t) => $e.compare(e.name, t.name) || $e.compare(e.id, t.id)).map((e) => e.children?.length ? {
		...e,
		children: et(e.children)
	} : e);
}
function tt(e, t) {
	let n = t.trim().toLowerCase();
	return !n || e.name.toLowerCase().includes(n) || (e.path?.display_path ?? "").toLowerCase().includes(n);
}
function nt(e, t = "") {
	return e.reduce((e, n) => e + +!!tt(n, t) + nt(n.children ?? [], t), 0);
}
//#endregion
//#region src/store/store.ts
var rt = 50, it = /* @__PURE__ */ new Set([
	"validation_error",
	"not_found",
	"conflict",
	"storage_error",
	"rate_limited",
	"unknown_error"
]), at = 2, ot = 4, st = 4, ct = 3e4, lt = 3, ut = {
	rateLimited: !1,
	connectionLost: !1,
	retrying: 0,
	nextRetryAt: null,
	reloading: !1,
	liveUpdates: "live",
	nextLiveRetryAt: null
};
function dt(e) {
	return String(e?.code ?? "unknown_error");
}
function ft(e) {
	return typeof e == "number" && Number.isFinite(e) && e >= 0 ? e : null;
}
function pt(e) {
	let t = e;
	for (let e of [
		t,
		t?.data,
		t?.context
	]) {
		if (!e || typeof e != "object") continue;
		let t = e, n = ft(t.retry_after_ms);
		if (n !== null) return n;
		let r = ft(t.retry_after);
		if (r !== null) return r * 1e3;
	}
	return null;
}
function mt(e, t, n) {
	let r = pt(e) ?? n * 2 ** t;
	return Math.min(r, ct);
}
function ht(e) {
	let t = {
		q: e.q || void 0,
		area_id: e.areaId || void 0,
		location_id: e.locationId ?? void 0,
		include_subtree: e.includeSubtree,
		checked_out: e.checkedOutOnly || void 0,
		low_stock_only: e.lowStockOnly || void 0,
		low_stock_first: e.lowStockFirst || void 0,
		orphaned_only: e.orphansOnly || void 0,
		overdue_only: e.overdueOnly || void 0,
		inspection_overdue_only: e.inspectionDueOnly || void 0,
		category: e.category || void 0,
		updated_after: e.updatedAfter || void 0,
		created_after: e.createdAfter || void 0,
		updated_before: e.updatedBefore || void 0,
		created_before: e.createdBefore || void 0
	};
	return e.tags.length && (e.tagsMode === "all" ? t.tags_all = [...e.tags] : t.tags_any = [...e.tags]), t;
}
function x() {
	return {
		q: "",
		areaId: null,
		locationId: null,
		includeSubtree: !0,
		checkedOutOnly: !1,
		lowStockFirst: !1,
		orphansOnly: !1,
		lowStockOnly: !1,
		overdueOnly: !1,
		inspectionDueOnly: !1,
		category: null,
		tags: [],
		tagsMode: "any",
		updatedAfter: null,
		createdAfter: null,
		updatedBefore: null,
		createdBefore: null,
		sort: Qe
	};
}
function S(e) {
	let t = 0;
	return e.q && (t += 1), e.areaId && (t += 1), e.locationId && (t += 1), e.checkedOutOnly && (t += 1), e.orphansOnly && (t += 1), e.lowStockOnly && (t += 1), e.lowStockFirst && (t += 1), e.overdueOnly && (t += 1), e.inspectionDueOnly && (t += 1), e.category && (t += 1), e.tags.length && (t += 1), e.updatedAfter && (t += 1), e.createdAfter && (t += 1), e.updatedBefore && (t += 1), e.createdBefore && (t += 1), t;
}
function gt(e) {
	let t = /* @__PURE__ */ new Set(), n = { ...e }, r = () => t.forEach((e) => e());
	return {
		get value() {
			return n;
		},
		set(e) {
			Object.assign(n, e), r();
		},
		onChange(e) {
			return t.add(e), () => t.delete(e);
		}
	};
}
var _t = class {
	constructor(e, t = {}) {
		this.inflight = /* @__PURE__ */ new Map(), this.itemsUnsub = null, this.statsUnsub = null, this.locationsUnsub = null, this.consecutiveTransportFailures = 0, this.treeRefreshHandle = null, this.subscribeRound = 0, this.subscribePending = 0, this.subscribeRefusal = null, this.subscribeAttempt = 0, this.subscribeRetryHandle = null, this.serverDistinct = null, this.drafts = {
			categories: [],
			tags: []
		}, this.ws = new Xe(e), this.retryBaseMs = t.retryBaseMs ?? 400;
		let n = {
			items: [],
			cursor: null,
			total: null,
			loading: !0,
			filters: x(),
			selection: /* @__PURE__ */ new Set(),
			pendingOps: /* @__PURE__ */ new Map(),
			errorQueue: [],
			areasCache: null,
			locationTreeCache: null,
			locationMatchTotal: null,
			locationsFlatCache: null,
			statsCounts: null,
			healthCache: null,
			versionInfo: null,
			distinctValuesCache: null,
			connected: {
				items: !1,
				stats: !1
			},
			degraded: { ...ut }
		};
		this.stateObs = gt(n);
	}
	get state() {
		return this.stateObs;
	}
	async init() {
		await Promise.all([
			this.refreshStats(),
			this.refreshHealth(),
			this.refreshAreas(),
			this.refreshLocationTree(),
			this.refreshLocationsFlat(),
			this.refreshDistinctValues(),
			this.refreshVersion()
		]), await this.listItems(!0), this.subscribeTopics();
	}
	subscribeTopics() {
		this.openSubscriptions(!0);
	}
	openSubscriptions(e) {
		this.cancelSubscribeRetry(), e && (this.subscribeAttempt = 0);
		let t = ++this.subscribeRound;
		this.subscribePending = lt, this.subscribeRefusal = null;
		let n = () => this.onSubscribeSettled(t, null), r = (e) => this.onSubscribeSettled(t, { err: e });
		this.itemsUnsub && this.itemsUnsub(), this.itemsUnsub = this.ws.subscribe("items", (e) => this.onItemsEvent(e), {
			location_id: this.state.value.filters.locationId ?? void 0,
			include_subtree: !0,
			onError: r,
			onOpen: n
		}), this.statsUnsub && this.statsUnsub(), this.statsUnsub = this.ws.subscribe("stats", (e) => this.onStatsEvent(e), {
			onError: r,
			onOpen: n
		}), this.locationsUnsub && this.locationsUnsub(), this.locationsUnsub = this.ws.subscribe("locations", (e) => this.onLocationsEvent(e), {
			onError: r,
			onOpen: n
		});
	}
	onSubscribeSettled(e, t) {
		if (e !== this.subscribeRound || (t && !this.subscribeRefusal && (this.subscribeRefusal = t), this.subscribePending > 0 && --this.subscribePending, this.subscribePending > 0)) return;
		let n = this.subscribeRefusal;
		if (!n) {
			this.subscribeAttempt = 0, this.stateObs.set({ connected: {
				items: !0,
				stats: !0
			} }), this.setDegraded({
				liveUpdates: "live",
				nextLiveRetryAt: null
			});
			return;
		}
		this.onSubscribeRefused(n.err);
	}
	onSubscribeRefused(e) {
		if (this.stateObs.set({ connected: {
			items: !1,
			stats: !1
		} }), dt(e) !== "rate_limited") {
			this.setDegraded({
				connectionLost: !0,
				liveUpdates: "paused",
				nextLiveRetryAt: null
			}), this.pushError(e);
			return;
		}
		if (this.subscribeAttempt >= st) {
			this.setDegraded({
				rateLimited: !0,
				liveUpdates: "paused",
				nextLiveRetryAt: null
			}), this.pushError(e);
			return;
		}
		let t = mt(e, this.subscribeAttempt, this.retryBaseMs);
		this.subscribeAttempt += 1, this.setDegraded({
			rateLimited: !0,
			liveUpdates: "retrying",
			nextLiveRetryAt: Date.now() + t
		}), this.subscribeRetryHandle = setTimeout(() => {
			this.subscribeRetryHandle = null, this.openSubscriptions(!1);
		}, t);
	}
	cancelSubscribeRetry() {
		this.subscribeRetryHandle !== null && (clearTimeout(this.subscribeRetryHandle), this.subscribeRetryHandle = null);
	}
	dispose() {
		this.itemsUnsub?.(), this.statsUnsub?.(), this.locationsUnsub?.(), this.itemsUnsub = this.statsUnsub = this.locationsUnsub = null, this.subscribeRound += 1, this.cancelSubscribeRetry(), this.treeRefreshHandle !== null && (clearTimeout(this.treeRefreshHandle), this.treeRefreshHandle = null), this.stateObs.set({ connected: {
			items: !1,
			stats: !1
		} });
	}
	onItemsEvent(e) {
		if (e.topic !== "items") return;
		if (e.action === "reloaded") {
			this.setDegraded({ reloading: !0 }), this.listItems(!0).catch(() => void 0).finally(() => this.setDegraded({ reloading: !1 })), this.refreshDistinctValues().catch(() => void 0), this.scheduleTreeRefresh();
			return;
		}
		let t = e.item, n = this.state.value.items.slice(), r = n.findIndex((e) => e.id === t.id);
		switch (e.action) {
			case "created":
			case "updated":
			case "moved":
			case "checked_out":
			case "checked_in":
			case "quantity_changed":
				r >= 0 ? n[r] = t : n.unshift(t);
				break;
			case "deleted":
				r >= 0 && n.splice(r, 1);
				break;
		}
		this.stateObs.set({ items: n }), (e.action === "created" || e.action === "updated" || e.action === "deleted") && this.refreshDistinctValues().catch(() => void 0), (e.action === "created" || e.action === "deleted" || e.action === "moved") && this.scheduleTreeRefresh();
	}
	scheduleTreeRefresh(e = 250) {
		this.treeRefreshHandle !== null && clearTimeout(this.treeRefreshHandle), this.treeRefreshHandle = setTimeout(() => {
			this.treeRefreshHandle = null, this.refreshLocationTree().catch(() => void 0);
		}, e);
	}
	onStatsEvent(e) {
		e.topic !== "stats" || e.action !== "counts" || this.stateObs.set({ statsCounts: e.counts });
	}
	onLocationsEvent(e) {
		if (e.topic === "locations") {
			if (e.action === "reloaded") {
				Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]), this.listItems(!0);
				return;
			}
			Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]), (e.action === "moved" || e.action === "renamed") && this.listItems(!0);
		}
	}
	async refreshStats() {
		let e = await this.run(() => this.ws.stats());
		this.stateObs.set({ statsCounts: e });
	}
	async refreshHealth() {
		let e = await this.run(() => this.ws.health());
		this.stateObs.set({ healthCache: e });
	}
	async refreshAreas() {
		let e = await this.run(() => this.ws.listAreas());
		this.stateObs.set({ areasCache: e });
	}
	async refreshDistinctValues() {
		let e = await this.run(() => this.ws.distinctValues());
		this.serverDistinct = e;
		let t = (e, t) => e.some((e) => e.value.toLowerCase() === t.toLowerCase());
		this.drafts = {
			categories: this.drafts.categories.filter((n) => !t(e.categories, n)),
			tags: this.drafts.tags.filter((n) => !t(e.tags, n))
		}, this.publishDistinct();
	}
	addDraftValue(e, t) {
		let n = e === "tag" ? t.trim().toLowerCase() : t.trim();
		if (!n) return !1;
		let r = e === "tag" ? "tags" : "categories";
		return (this.state.value.distinctValuesCache?.[r] ?? []).some((e) => e.value.toLowerCase() === n.toLowerCase()) ? !1 : (this.drafts = {
			...this.drafts,
			[r]: [...this.drafts[r], n]
		}, this.publishDistinct(), !0);
	}
	removeDraftValue(e, t) {
		let n = e === "tag" ? "tags" : "categories";
		this.drafts = {
			...this.drafts,
			[n]: this.drafts[n].filter((e) => e.toLowerCase() !== t.toLowerCase())
		}, this.publishDistinct();
	}
	isDraftValue(e, t) {
		let n = e === "tag" ? "tags" : "categories";
		return this.drafts[n].some((e) => e.toLowerCase() === t.toLowerCase());
	}
	publishDistinct() {
		let e = this.serverDistinct;
		if (!e) return;
		let t = (e, t) => t.length ? [...e, ...t.map((e) => ({
			value: e,
			count: 0
		}))].sort((e, t) => e.value.toLowerCase().localeCompare(t.value.toLowerCase())) : e;
		this.stateObs.set({ distinctValuesCache: {
			...e,
			categories: t(e.categories, this.drafts.categories),
			tags: t(e.tags, this.drafts.tags)
		} });
	}
	async refreshVersion() {
		let e = await this.run(() => this.ws.version());
		this.stateObs.set({ versionInfo: e });
	}
	locationCountFilters() {
		return {
			...this.state.value.filters,
			locationId: null,
			includeSubtree: !0,
			orphansOnly: !1
		};
	}
	async refreshLocationTree() {
		let e = this.locationCountFilters(), t = S(e) > 0, n = await this.run(() => this.ws.getLocationTree(t ? ht(e) : void 0));
		this.stateObs.set({ locationTreeCache: et(n ?? []) }), this.stateObs.set({ locationMatchTotal: t ? await this.countMatching(e) : null });
	}
	async refreshLocationsFlat() {
		let e = (await this.run(() => this.ws.listLocations())).slice().sort((e, t) => (e.path?.sort_key || "").localeCompare(t.path?.sort_key || "", void 0, { sensitivity: "base" }));
		this.stateObs.set({ locationsFlatCache: e });
	}
	async listItems(e = !1) {
		let t = this.state.value, n = ht(t.filters), r = t.filters.sort, i = rt, a = e ? void 0 : t.cursor || void 0, o = JSON.stringify({
			op: "list",
			filter: n,
			sort: r,
			limit: i,
			cursor: a
		});
		if (this.inflight.has(o)) return this.inflight.get(o);
		let s = this.ws.listItems(n, r, i, a).then((t) => {
			this.noteSuccess();
			let n = e ? t.items : xt(this.state.value.items, t.items);
			this.stateObs.set({
				items: n,
				cursor: t.next_cursor,
				total: typeof t.total == "number" ? t.total : null,
				loading: !1
			});
		}).catch((e) => {
			this.noteFailure(e), this.stateObs.set({ loading: !1 }), this.pushError(e);
		}).finally(() => this.inflight.delete(o));
		return this.inflight.set(o, s), s;
	}
	async countMatching(e) {
		try {
			let t = await this.ws.listItems(ht(e), e.sort, 1);
			return typeof t.total == "number" ? t.total : null;
		} catch {
			return null;
		}
	}
	async listAllMatching(e) {
		return (await this.ws.listItems(e)).items;
	}
	async loadAllPages(e = 200) {
		let t = 0;
		for (; this.state.value.cursor && t < e;) {
			let e = this.state.value.cursor;
			if (await this.listItems(!1), t += 1, this.state.value.cursor === e) break;
		}
	}
	async prefetchIfNeeded(e) {
		e < .7 || this.state.value.cursor && await this.listItems(!1);
	}
	setFilters(e) {
		let t = {
			...this.state.value.filters,
			...e
		}, n = t.locationId !== this.state.value.filters.locationId;
		this.stateObs.set({
			filters: t,
			cursor: null,
			items: [],
			total: null,
			loading: !0,
			selection: /* @__PURE__ */ new Set()
		}), n && this.subscribeTopics(), this.listItems(!0), Object.keys(e).some((e) => e !== "sort") && this.scheduleTreeRefresh();
	}
	clearFilters() {
		this.setFilters({
			...x(),
			sort: this.state.value.filters.sort
		});
	}
	setSelection(e) {
		this.stateObs.set({ selection: e });
	}
	toggleSelected(e) {
		let t = new Set(this.state.value.selection);
		t.has(e) ? t.delete(e) : t.add(e), this.setSelection(t);
	}
	setSelected(e) {
		this.setSelection(new Set(e));
	}
	clearSelection() {
		this.state.value.selection.size !== 0 && this.setSelection(/* @__PURE__ */ new Set());
	}
	selectAllLoaded() {
		this.setSelection(new Set(this.state.value.items.map((e) => e.id)));
	}
	async loadAllThenSelectAll() {
		await this.loadAllPages(), this.selectAllLoaded();
	}
	setDegraded(e) {
		let t = {
			...this.state.value.degraded,
			...e
		}, n = this.state.value.degraded;
		n.rateLimited === t.rateLimited && n.connectionLost === t.connectionLost && n.retrying === t.retrying && n.nextRetryAt === t.nextRetryAt && n.reloading === t.reloading && n.liveUpdates === t.liveUpdates && n.nextLiveRetryAt === t.nextLiveRetryAt || this.stateObs.set({ degraded: t });
	}
	noteSuccess() {
		this.consecutiveTransportFailures = 0, this.state.value.degraded.connectionLost && this.setDegraded({ connectionLost: !1 });
	}
	noteFailure(e) {
		let t = dt(e);
		if (t === "rate_limited") {
			this.setDegraded({ rateLimited: !0 });
			return;
		}
		if (it.has(t) && t !== "unknown_error") {
			this.consecutiveTransportFailures = 0;
			return;
		}
		this.consecutiveTransportFailures += 1, this.consecutiveTransportFailures >= at && this.setDegraded({ connectionLost: !0 });
	}
	sleep(e) {
		return e <= 0 ? Promise.resolve() : new Promise((t) => setTimeout(t, e));
	}
	async run(e) {
		for (let t = 0;; t++) try {
			let n = await e();
			return this.noteSuccess(), t > 0 && this.setDegraded({
				retrying: Math.max(0, this.state.value.degraded.retrying - 1),
				nextRetryAt: null
			}), n;
		} catch (e) {
			if (this.noteFailure(e), !(dt(e) === "rate_limited" && t < ot - 1)) throw t > 0 && this.setDegraded({
				retrying: Math.max(0, this.state.value.degraded.retrying - 1),
				nextRetryAt: null
			}), e;
			let n = this.retryBaseMs * 2 ** t;
			this.setDegraded({
				retrying: t === 0 ? this.state.value.degraded.retrying + 1 : this.state.value.degraded.retrying,
				nextRetryAt: Date.now() + n
			}), await this.sleep(n);
		}
	}
	async refreshAll() {
		this.consecutiveTransportFailures = 0, this.setDegraded({ ...ut }), await this.reloadAll(), this.subscribeTopics();
	}
	async createItem(e) {
		let t = `create:${Date.now()}`;
		this.state.value.pendingOps.set(t, { kind: "create" });
		try {
			let t = await this.run(() => this.ws.createItem(e)), n = xt(this.state.value.items, [t]);
			this.stateObs.set({ items: n });
		} catch (e) {
			this.pushError(e);
		} finally {
			this.state.value.pendingOps.delete(t), this.stateObs.set({ pendingOps: new Map(this.state.value.pendingOps) });
		}
	}
	async updateItem(e, t, n) {
		let r = `update:${e}:${Date.now()}`;
		this.state.value.pendingOps.set(r, {
			kind: "update",
			itemId: e
		});
		let i = this.state.value.items.find((t) => t.id === e);
		if (i) {
			let e = {
				...i,
				...t
			};
			this.applyOptimistic(e);
		}
		try {
			let r = await this.run(() => this.ws.updateItem(e, t, n));
			this.applyOptimistic(r);
		} catch (n) {
			this.pushError(n, {
				itemId: e,
				changes: t
			}), i && this.applyOptimistic(i);
		} finally {
			this.state.value.pendingOps.delete(r), this.stateObs.set({ pendingOps: new Map(this.state.value.pendingOps) });
		}
	}
	async deleteItem(e, t) {
		let n = `delete:${e}:${Date.now()}`;
		this.state.value.pendingOps.set(n, {
			kind: "delete",
			itemId: e
		});
		let r = this.state.value.items.find((t) => t.id === e);
		r && this.removeById(e);
		try {
			await this.run(() => this.ws.deleteItem(e, t));
		} catch (e) {
			this.pushError(e), r && this.applyOptimistic(r);
		} finally {
			this.state.value.pendingOps.delete(n), this.stateObs.set({ pendingOps: new Map(this.state.value.pendingOps) });
		}
	}
	async adjustQuantity(e, t, n) {
		let r = this.state.value.items.find((t) => t.id === e);
		r && this.applyOptimistic({
			...r,
			quantity: r.quantity + t
		});
		try {
			let r = await this.run(() => this.ws.adjustQuantity(e, t, n));
			this.applyOptimistic(r);
		} catch (e) {
			this.pushError(e), r && this.applyOptimistic(r);
		}
	}
	async setQuantity(e, t, n) {
		let r = this.state.value.items.find((t) => t.id === e);
		r && this.applyOptimistic({
			...r,
			quantity: t
		});
		try {
			let r = await this.run(() => this.ws.setQuantity(e, t, n));
			this.applyOptimistic(r);
		} catch (e) {
			this.pushError(e), r && this.applyOptimistic(r);
		}
	}
	async checkOut(e, t, n) {
		let r = this.state.value.items.find((t) => t.id === e);
		r && this.applyOptimistic({
			...r,
			checked_out: !0,
			due_date: t ?? r.due_date
		});
		try {
			let r = await this.run(() => this.ws.checkOut(e, t, n));
			this.applyOptimistic(r);
		} catch (e) {
			this.pushError(e), r && this.applyOptimistic(r);
		}
	}
	async markCheckedIn(e, t) {
		let n = this.state.value.items.find((t) => t.id === e);
		n && this.applyOptimistic({
			...n,
			checked_out: !1
		});
		try {
			let n = await this.run(() => this.ws.markCheckedIn(e, t));
			this.applyOptimistic(n);
		} catch (e) {
			this.pushError(e), n && this.applyOptimistic(n);
		}
	}
	async setLowStockThreshold(e, t, n) {
		let r = this.state.value.items.find((t) => t.id === e);
		r && this.applyOptimistic({
			...r,
			low_stock_threshold: t
		});
		try {
			let r = await this.run(() => this.ws.setLowStockThreshold(e, t, n));
			this.applyOptimistic(r);
		} catch (e) {
			this.pushError(e), r && this.applyOptimistic(r);
		}
	}
	async moveItem(e, t, n) {
		let r = this.state.value.items.find((t) => t.id === e);
		r && this.applyOptimistic({
			...r,
			location_id: t
		});
		try {
			let r = await this.run(() => this.ws.moveItem(e, t, n));
			this.applyOptimistic(r);
		} catch (e) {
			this.pushError(e), r && this.applyOptimistic(r);
		}
	}
	async createLocation(e, t, n) {
		let r = await this.ws.createLocation(e, t ?? null, n ?? void 0);
		return await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]), r;
	}
	async updateLocation(e, t) {
		let n = await this.ws.updateLocation(e, t);
		return await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]), n;
	}
	async deleteLocation(e) {
		await this.ws.deleteLocation(e), await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
	}
	async moveLocationSubtree(e, t) {
		let n = await this.ws.moveLocationSubtree(e, t);
		return await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]), await this.listItems(!0), n;
	}
	async bulkExecute(e, t = {}) {
		let n = Math.max(1, t.chunkSize ?? 25), r = [], i = [], a = /* @__PURE__ */ new Set(), o = 0, s = !1;
		for (let c = 0; c < e.length; c += n) {
			if (t.isCancelled?.()) {
				s = !0;
				break;
			}
			let l = e.slice(c, c + n), u = new Map(l.map((e) => [e.op_id, e]));
			try {
				let e = (await this.run(() => this.ws.bulk(l)))?.results ?? {};
				for (let [t, n] of Object.entries(e)) {
					let e = u.get(t);
					if (n?.success) {
						a.add(t);
						let e = n.result;
						e && typeof e.id == "string" && (r.push(e), this.applyOptimistic(e));
					} else e && i.push({
						op: e,
						error: n?.error ?? bt(),
						itemId: yt(e)
					});
				}
				for (let t of l) t.op_id in e || i.push({
					op: t,
					error: bt("no result returned for this operation"),
					itemId: yt(t)
				});
			} catch (e) {
				let t = {
					code: dt(e),
					message: String(e?.message ?? "Batch failed")
				};
				for (let e of l) i.push({
					op: e,
					error: t,
					itemId: yt(e)
				});
			}
			o += l.length, t.onProgress?.(o, e.length, i.length);
		}
		for (let t of e) {
			if (t.kind !== "item_delete" || !a.has(t.op_id)) continue;
			let e = yt(t);
			e && this.removeById(e);
		}
		return this.refreshStats().catch(() => void 0), this.refreshDistinctValues().catch(() => void 0), this.scheduleTreeRefresh(), {
			succeeded: r,
			failed: i,
			cancelled: s
		};
	}
	async exportDocument(e = "all") {
		return this.ws.exportDocument(e === "view" ? ht(this.state.value.filters) : void 0);
	}
	async previewImport(e, t) {
		return this.ws.importPreview(e, t);
	}
	async executeImport(e, t) {
		let n = await this.ws.importExecute(e, t);
		return await this.reloadAll(), n;
	}
	async reloadAll() {
		await Promise.all([
			this.refreshStats(),
			this.refreshHealth(),
			this.refreshLocationsFlat(),
			this.refreshLocationTree(),
			this.refreshDistinctValues()
		]), await this.listItems(!0);
	}
	pushError(e, t) {
		let n = e, r = String(n?.code ?? "unknown_error"), i = String(n?.message ?? "Unknown error"), a = n?.context ?? n?.data ?? null, o = {
			id: `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
			code: r,
			message: i,
			context: a ?? void 0,
			kind: r === "conflict" ? "conflict" : "error",
			itemId: t?.itemId,
			changes: t?.changes
		}, s = this.state.value.errorQueue.concat([o]);
		this.stateObs.set({ errorQueue: s });
	}
	dismissError(e) {
		let t = this.state.value.errorQueue.filter((t) => t.id !== e);
		this.stateObs.set({ errorQueue: t });
	}
	async refreshItem(e) {
		try {
			let t = await this.ws.getItem(e);
			this.applyOptimistic(t);
		} catch (e) {
			this.pushError(e);
		}
	}
	applyOptimistic(e) {
		let t = this.state.value.items.slice(), n = t.findIndex((t) => t.id === e.id);
		n >= 0 ? t[n] = e : t.unshift(e), this.stateObs.set({ items: t });
	}
	removeById(e) {
		let t = this.state.value.items.filter((t) => t.id !== e);
		this.stateObs.set({ items: t });
	}
}, vt = 0;
function C(e, t) {
	return vt += 1, {
		op_id: `${e}:${typeof t.item_id == "string" ? t.item_id : "op"}:${vt}`,
		kind: e,
		payload: t
	};
}
function yt(e) {
	let t = e.payload?.item_id;
	return typeof t == "string" ? t : null;
}
function bt(e = "Operation failed") {
	return {
		code: "unknown_error",
		message: e
	};
}
function xt(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let t of e) n.set(t.id, t);
	for (let e of t) n.set(e.id, e);
	let r = t.filter((t) => !e.some((e) => e.id === t.id));
	return e.map((e) => n.get(e.id)).concat(r);
}
//#endregion
//#region src/store/columns.ts
var St = [
	{
		key: "quantity",
		label: "Qty",
		tableSize: "70px",
		sortField: "quantity"
	},
	{
		key: "category",
		label: "Category",
		tableSize: "minmax(110px, 1fr)"
	},
	{
		key: "location",
		label: "Location",
		tableSize: "minmax(110px, 1fr)"
	},
	{
		key: "tags",
		label: "Tags",
		tableSize: "minmax(120px, 1.4fr)"
	},
	{
		key: "due_date",
		label: "Due",
		tableSize: "100px",
		sortField: "due_date"
	},
	{
		key: "inspection_date",
		label: "Next inspection",
		tableSize: "124px",
		sortField: "inspection_date"
	},
	{
		key: "updated_at",
		label: "Updated",
		tableSize: "96px",
		sortField: "updated_at"
	}
], Ct = St.map((e) => e.key), wt = [
	"quantity",
	"category",
	"tags",
	"due_date",
	"updated_at"
], Tt = "haventory:columns:v1";
function w(e) {
	if (!Array.isArray(e)) return [];
	let t = new Set(e.filter((e) => Ct.includes(e)));
	return Ct.filter((e) => t.has(e));
}
var Et = Object.fromEntries(St.map((e) => [e.key, e.tableSize]));
function Dt(e, t) {
	return [
		...t.selectable ? ["40px"] : [],
		"minmax(180px, 2fr)",
		...w(e).map((e) => Et[e]),
		"110px"
	].join(" ");
}
function Ot() {
	try {
		return typeof localStorage > "u" ? null : localStorage;
	} catch {
		return null;
	}
}
function kt() {
	let e = Ot();
	if (!e) return [...wt];
	try {
		let t = e.getItem(Tt);
		if (!t) return [...wt];
		let n = JSON.parse(t);
		return "expanded" in n ? w(n.expanded) : [...wt];
	} catch {
		return [...wt];
	}
}
function At(e) {
	let t = Ot();
	if (t) try {
		t.setItem(Tt, JSON.stringify({ expanded: w(e) }));
	} catch {}
}
//#endregion
//#region src/ui/theme.ts
var jt = .1, Mt = .4, Nt = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, Pt = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;
function Ft(e) {
	let t = e / 255;
	return t <= .04045 ? t / 12.92 : ((t + .055) / 1.055) ** 2.4;
}
function It(e) {
	let t = e.trim();
	if (!t) return null;
	let n, r, i;
	if (Nt.test(t)) {
		let e = t.slice(1), a = e.length === 3 ? [...e].map((e) => e + e).join("") : e;
		n = parseInt(a.slice(0, 2), 16), r = parseInt(a.slice(2, 4), 16), i = parseInt(a.slice(4, 6), 16);
	} else {
		let e = Pt.exec(t);
		if (!e) return null;
		let a = e[4], o = a === void 0 ? 1 : a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
		if (!Number.isFinite(o) || o < jt) return null;
		n = Number(e[1]), r = Number(e[2]), i = Number(e[3]);
	}
	return [
		n,
		r,
		i
	].every((e) => Number.isFinite(e)) ? .2126 * Ft(n) + .7152 * Ft(r) + .0722 * Ft(i) : null;
}
function Lt(e) {
	let t = It(e);
	return t === null ? null : t <= Mt ? "dark" : "light";
}
var Rt = [
	"--card-background-color",
	"--ha-card-background",
	"--primary-background-color"
];
function zt(e) {
	for (let t of Rt) {
		let n = Lt(e.getPropertyValue(t) ?? "");
		if (n) return n;
	}
	return null;
}
//#endregion
//#region node_modules/@lit/reactive-element/decorators/custom-element.js
var T = (e) => (t, n) => {
	n === void 0 ? customElements.define(e, t) : n.addInitializer(() => {
		customElements.define(e, t);
	});
}, Bt = {
	attribute: !0,
	type: String,
	converter: oe,
	reflect: !1,
	hasChanged: se
}, Vt = (e = Bt, t, n) => {
	let { kind: r, metadata: i } = n, a = globalThis.litPropertyMetadata.get(i);
	if (a === void 0 && globalThis.litPropertyMetadata.set(i, a = /* @__PURE__ */ new Map()), r === "setter" && ((e = Object.create(e)).wrapped = !0), a.set(n.name, e), r === "accessor") {
		let { name: r } = n;
		return {
			set(n) {
				let i = t.get.call(this);
				t.set.call(this, n), this.requestUpdate(r, i, e, !0, n);
			},
			init(t) {
				return t !== void 0 && this.C(r, void 0, e, t), t;
			}
		};
	}
	if (r === "setter") {
		let { name: r } = n;
		return function(n) {
			let i = this[r];
			t.call(this, n), this.requestUpdate(r, i, e, !0, n);
		};
	}
	throw Error("Unsupported decorator location: " + r);
};
function E(e) {
	return (t, n) => typeof n == "object" ? Vt(e, t, n) : ((e, t, n) => {
		let r = t.hasOwnProperty(n);
		return t.constructor.createProperty(n, e), r ? Object.getOwnPropertyDescriptor(t, n) : void 0;
	})(e, t, n);
}
//#endregion
//#region node_modules/@lit/reactive-element/decorators/state.js
function D(e) {
	return E({
		...e,
		state: !0,
		attribute: !1
	});
}
//#endregion
//#region src/ui/tokens.ts
var O = o`
  :host {
    /* Surfaces */
    --hv-surface: var(--card-background-color, var(--ha-card-background, light-dark(#fff, #1c1c1c)));
    --hv-surface-raised: light-dark(#f5f5f5, #232323);
    --hv-page: var(--primary-background-color, light-dark(#fafafa, #111));
    --hv-scrim: rgba(0, 0, 0, 0.5);

    /* Text */
    --hv-text: var(--primary-text-color, light-dark(#212121, #e1e1e1));
    --hv-text-secondary: var(--secondary-text-color, light-dark(#727272, #9b9b9b));
    --hv-text-tertiary: light-dark(#9e9e9e, #7d7d7d);
    --hv-text-on-primary: var(--text-primary-color, #fff);

    /* Lines */
    --hv-divider: var(--divider-color, light-dark(#e0e0e0, #383838));
    --hv-row-divider: light-dark(#ededed, #2e2e2e);

    /* Primary / accent */
    --hv-primary: var(--primary-color, #03a9f4);
    --hv-primary-dark: light-dark(#0288d1, #4fc3f7);
    --hv-primary-darker: light-dark(#0277bd, #4fc3f7);
    --hv-primary-tint: light-dark(#e3f4fd, rgba(3, 169, 244, 0.16));
    --hv-primary-tint-border: light-dark(#a8d8f0, rgba(3, 169, 244, 0.5));
    --hv-row-hover: light-dark(#f5f9fd, rgba(255, 255, 255, 0.04));

    /* Warning / low stock */
    --hv-warn: light-dark(#b26b00, #ffb74d);
    --hv-warn-bg: light-dark(#fff4e0, rgba(255, 167, 38, 0.14));
    --hv-warn-deep: light-dark(#7a4d00, #ffb74d);
    --hv-warn-border: light-dark(#e0c98f, rgba(255, 167, 38, 0.4));
    --hv-amber: #ffa726;

    /* Error */
    --hv-error: var(--error-color, light-dark(#c62828, #ef5350));
    --hv-error-bg: light-dark(#fdecea, rgba(198, 40, 40, 0.14));
    --hv-error-deep: light-dark(#8b1f1a, #ef9a9a);
    --hv-error-border: light-dark(#e6a9a4, rgba(239, 83, 80, 0.7));
    --hv-error-soft: light-dark(#c62828, #ef9a9a);

    /* Success */
    --hv-success: light-dark(#2e7d32, #81c784);

    /* Inputs */
    --hv-input-bg: var(--input-fill-color, light-dark(#f5f5f5, #2b2b2b));
    --hv-input-border: light-dark(#cfd8dc, #4a4a4a);
    --hv-chip-bg: light-dark(#e7e7e7, #2b2b2b);
    --hv-chip-text: light-dark(#4a4a4a, #bdbdbd);

    /* Interaction */
    --hv-hover-overlay: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08));

    /* Shape */
    --hv-radius-card: var(--ha-card-border-radius, 12px);
    --hv-radius-panel: 12px;
    --hv-radius-dialog: 14px;
    --hv-radius-input: 8px;
    --hv-radius-chip: 999px;
    --hv-radius-sheet: 20px;
    /* How wide a bottom sheet is allowed to get before it stops growing with
       the viewport. Roughly HA's own more-info dialog. */
    --hv-sheet-max-width: 640px;

    /* Elevation */
    --hv-shadow-menu: 0 8px 28px rgba(0, 0, 0, 0.22);
    --hv-shadow-dialog: 0 12px 40px rgba(0, 0, 0, 0.28);
    --hv-shadow-overlay: 0 8px 32px rgba(0, 0, 0, 0.18);
    --hv-shadow-sheet: light-dark(0 -8px 32px rgba(0, 0, 0, 0.3), 0 -8px 32px rgba(0, 0, 0, 0.5));

    /* Type */
    --hv-font: var(--ha-card-font-family, var(--paper-font-body1_-_font-family, Roboto, sans-serif));

    /* Motion — collapses to 0 under prefers-reduced-motion (see below). */
    --hv-motion-fast: 120ms;
    --hv-motion-panel: 180ms;
    --hv-motion-sheet: 240ms;
    --hv-ease-out: cubic-bezier(0.25, 0.8, 0.25, 1);
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      --hv-motion-fast: 0ms;
      --hv-motion-panel: 0ms;
      --hv-motion-sheet: 0ms;
    }
  }
`, k = o`
  :host {
    font-family: var(--hv-font);
    color: var(--hv-text);
  }

  button {
    font-family: inherit;
    cursor: pointer;
  }

  button:focus-visible,
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible,
  [tabindex]:focus-visible {
    outline: 2px solid var(--hv-primary);
    outline-offset: -1px;
  }

  .hv-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: var(--hv-tap-min, auto);
    border-radius: var(--hv-radius-chip);
    border: none;
    padding: 7px 14px;
    font-size: 13px;
    font-weight: 500;
    background: var(--hv-primary);
    color: var(--hv-text-on-primary);
  }
  .hv-pill:hover {
    opacity: 0.9;
  }
  .hv-pill[disabled] {
    opacity: 0.5;
    cursor: default;
  }

  .hv-pill.outline {
    background: transparent;
    color: var(--hv-primary-darker);
    border: 1px solid var(--hv-divider);
    font-weight: 500;
  }
  .hv-pill.outline:hover {
    background: var(--hv-hover-overlay);
    opacity: 1;
  }

  .hv-text-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--hv-tap-min, auto);
    background: none;
    border: none;
    color: var(--hv-primary-dark);
    font: 500 13px var(--hv-font);
    padding: 8px 12px;
    border-radius: var(--hv-radius-input);
  }
  .hv-text-button:hover {
    background: var(--hv-hover-overlay);
  }
  .hv-text-button.danger {
    color: var(--hv-error-soft);
  }

  .hv-icon-button {
    display: inline-grid;
    place-items: center;
    width: var(--hv-tap-min, 34px);
    height: var(--hv-tap-min, 34px);
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--hv-text-secondary);
    padding: 0;
    flex: none;
  }
  .hv-icon-button:hover {
    background: var(--hv-hover-overlay);
  }
  .hv-icon-button[disabled] {
    opacity: 0.4;
    cursor: default;
  }

  .hv-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--hv-text-secondary);
  }

  .hv-input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    background: var(--hv-surface);
    color: var(--hv-text);
    border: 1px solid var(--hv-input-border);
    border-radius: var(--hv-radius-input);
    padding: 9px 11px;
    font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
  }
  .hv-input:focus {
    border-color: var(--hv-primary);
    outline: none;
  }

  .hv-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
`, Ht = /^(mac|iphone|ipad|ipod)/i;
function Ut(e = navigator) {
	let t = e.userAgentData?.platform ?? e.platform;
	return t ? Ht.test(t) : /\b(Macintosh|Mac OS X|iPhone|iPad|iPod)\b/.test(e.userAgent ?? "");
}
function A(e) {
	return (t) => {
		t.key === "Escape" && (t.preventDefault(), e());
	};
}
function Wt(e = navigator) {
	return Ut(e) ? "⌘↵" : "Ctrl+Enter";
}
//#endregion
//#region node_modules/lit-html/directives/if-defined.js
var Gt = (e) => e ?? y, Kt = {
	plus: "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z",
	minus: "M19,13H5V11H19V13Z",
	close: "M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z",
	check: "M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z",
	checkCircle: "M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M10,17L5,12L6.41,10.58L10,14.17L17.59,6.58L19,8L10,17Z",
	chevronDown: "M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z",
	chevronRight: "M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z",
	chevronUp: "M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z",
	dotsVertical: "M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z",
	magnify: "M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z",
	tune: "M3,17V19H9V17H3M3,5V7H13V5H3M13,21V19H21V17H13V15H11V21H13M7,9V11H3V13H7V15H9V9H7M21,13V11H11V13H21M15,9H17V7H21V5H17V3H15V9Z",
	arrowExpand: "M10,21V19H6.41L10.91,14.5L9.5,13.09L5,17.59V14H3V21H10M14.5,10.91L19,6.41V10H21V3H14V5H17.59L13.09,9.5L14.5,10.91Z",
	openInNew: "M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z",
	pencil: "M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z",
	del: "M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z",
	mapMarker: "M12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5M12,2A7,7 0 0,0 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9A7,7 0 0,0 12,2Z",
	calendar: "M19,19H5V8H19M16,1V3H8V1H6V3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3H18V1",
	account: "M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z",
	home: "M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z",
	alert: "M13,14H11V9H13M13,18H11V16H13M1,21H23L12,2L1,21Z",
	alertCircle: "M13,13H11V7H13M13,17H11V15H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z",
	viewColumn: "M4,5V19H8V5H4M10,5V19H14V5H10M16,5V19H20V5H16Z",
	download: "M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z",
	upload: "M9,16V10H5L12,3L19,10H15V16H9M5,20V18H19V20H5Z",
	refresh: "M17.65,6.35A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 19.73,14H17.65A6,6 0 0,1 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z",
	callMerge: "M17,20.41L18.41,19L15,15.59L13.59,17M7.5,8H11V13.59L5.59,19L7,20.41L13,14.41V8H16.5L12,3.5",
	arrowLeft: "M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z",
	arrowRight: "M4,11V13H16L10.5,18.5L11.92,19.92L19.84,12L11.92,4.08L10.5,5.5L16,11H4Z",
	select: "M9,9H15V15H9M11,7H13V9H11M9,17H15V19H9M17,9H19V15H17M5,9H7V15H5M11,17H13V19H11M11,3H13V5H11Z",
	wifiOff: "M2.28,3L1,4.27L2.47,5.74C1.53,6.5 0.72,7.43 0,8.5C3,12.11 6.6,14 12,14C13.16,14 14.25,13.9 15.28,13.71L17.5,15.93L18.78,14.66L2.28,3M12,10C9.79,10 8,8.21 8,6C8,5.72 8.03,5.45 8.08,5.19L12.81,9.92C12.55,9.97 12.28,10 12,10Z",
	clock: "M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12.5,7H11V13L15.75,15.85L16.5,14.62L12.5,12.25V7Z"
};
function j(e, t = 18, n) {
	let r = Kt[e];
	return v`<svg
    class="hv-icon"
    viewBox="0 0 24 24"
    width=${t}
    height=${t}
    part="icon"
    fill="currentColor"
    aria-hidden=${n ? "false" : "true"}
    role=${n ? "img" : "presentation"}
    aria-label=${Gt(n)}
    data-icon=${e}
  >
    ${ke`<path d=${r}></path>`}
  </svg>`;
}
//#endregion
//#region src/utils/zindex.ts
var qt = 1e4, Jt = 2, Yt = "__haventoryZBase";
function M() {
	let e = window, t = (typeof e[Yt] == "number" ? e[Yt] : qt) + Jt;
	return e[Yt] = t, t;
}
//#endregion
//#region src/ui/dialog-focus.ts
function Xt() {
	let e = document.activeElement;
	for (; e?.shadowRoot?.activeElement;) e = e.shadowRoot.activeElement;
	return e;
}
var Zt = class {
	constructor() {
		this._returnTo = null, this._active = !1;
	}
	sync(e, t) {
		if (e && !this._active) {
			this._active = !0, this._returnTo = Xt();
			let e = t();
			e && (e.hasAttribute("tabindex") || e.setAttribute("tabindex", "-1"), e.focus({ preventScroll: !0 }));
			return;
		}
		if (!e && this._active) {
			this._active = !1;
			let e = this._returnTo;
			this._returnTo = null, e?.isConnected && e.focus({ preventScroll: !0 });
		}
	}
};
//#endregion
//#region \0@oxc-project+runtime@0.139.0/helpers/esm/decorate.js
function N(e, t, n, r) {
	var i = arguments.length, a = i < 3 ? t : r === null ? r = Object.getOwnPropertyDescriptor(t, n) : r, o;
	if (typeof Reflect == "object" && typeof Reflect.decorate == "function") a = Reflect.decorate(e, t, n, r);
	else for (var s = e.length - 1; s >= 0; s--) (o = e[s]) && (a = (i < 3 ? o(a) : i > 3 ? o(t, n, a) : o(t, n)) || a);
	return i > 3 && a && Object.defineProperty(t, n, a), a;
}
//#endregion
//#region src/components/hv-column-picker.ts
var Qt, $t = (Qt = class extends b {
	constructor(...e) {
		super(...e), this.open = !1, this.columns = [], this.heading = "Columns", this._zBase = null, this._dialogFocus = new Zt(), this._close = () => {
			this.dispatchEvent(new CustomEvent("cancel", {
				bubbles: !0,
				composed: !0
			})), this.open = !1;
		};
	}
	updated() {
		this._dialogFocus.sync(this.open, () => this.renderRoot.querySelector("[role=\"dialog\"]"));
	}
	willUpdate(e) {
		e.has("open") && this.open && (this._zBase = M());
	}
	_toggle(e, t) {
		let n = new Set(w(this.columns));
		t ? n.add(e) : n.delete(e);
		let r = w([...n]);
		this.dispatchEvent(new CustomEvent("change", {
			detail: { columns: r },
			bubbles: !0,
			composed: !0
		}));
	}
	render() {
		if (!this.open) return null;
		let e = new Set(w(this.columns));
		return v`
      <div class="backdrop" role="presentation" style="z-index: ${this._zBase ?? 9998};" @click=${this._close}></div>
      <div class="panel-wrap" role="none" style="z-index: ${(this._zBase ?? 9998) + 1};">
        <div class="panel" role="dialog" aria-modal="true" aria-label="Column selection"
          @keydown=${A(() => this._close())}>
          <h2>${this.heading}</h2>
          <ul data-testid="column-options">
            ${St.map((t) => {
			let n = e.has(t.key);
			return v`
                <li>
                  <button
                    class="option"
                    role="checkbox"
                    aria-checked=${String(n)}
                    data-testid="column-option"
                    data-key=${t.key}
                    @click=${() => this._toggle(t.key, !n)}
                  >
                    <span class="box ${n ? "on" : ""}">${n ? j("check", 12) : null}</span>
                    <span>${t.label}</span>
                  </button>
                </li>
              `;
		})}
          </ul>
          <div class="actions">
            <button class="hv-pill" data-testid="column-picker-done" @click=${this._close}>Done</button>
          </div>
        </div>
      </div>
    `;
	}
}, Qt.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
      }
      .panel-wrap {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 16px;
        box-sizing: border-box;
      }
      .panel {
        width: 330px;
        max-width: 100%;
        box-sizing: border-box;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: var(--hv-radius-dialog);
        box-shadow: var(--hv-shadow-dialog);
        padding: 14px 14px 12px;
      }
      h2 {
        margin: 0 0 6px;
        padding: 0 4px;
        font-size: 15px;
        font-weight: 500;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        margin: 0;
      }
      /* The same control the filter panel's checkboxes use, so a tick means the
         same thing — and picks up --hv-tap-min on a phone. */
      .option {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        box-sizing: border-box;
        min-height: var(--hv-tap-min, 34px);
        border: none;
        background: none;
        text-align: left;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
        padding: 4px 6px;
        border-radius: var(--hv-radius-input);
      }
      .option:hover {
        background: var(--hv-hover-overlay);
      }
      .box {
        display: inline-grid;
        place-items: center;
        width: 15px;
        height: 15px;
        border-radius: 4px;
        border: 1.5px solid var(--hv-text-tertiary);
        color: #fff;
        flex: none;
      }
      .box.on {
        background: var(--hv-primary);
        border-color: var(--hv-primary);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        padding-top: 8px;
      }
    `
], Qt);
N([E({
	type: Boolean,
	reflect: !0
})], $t.prototype, "open", void 0), N([E({ attribute: !1 })], $t.prototype, "columns", void 0), N([E({ type: String })], $t.prototype, "heading", void 0), N([D()], $t.prototype, "_zBase", void 0), $t = N([T("hv-column-picker")], $t);
//#endregion
//#region src/ui/plural.ts
function en(e, t, n = `${t}s`) {
	return e === 1 ? t : n;
}
function P(e, t, n = `${t}s`) {
	return `${e} ${en(e, t, n)}`;
}
var tn = class {
	constructor(e, t = 600) {
		this.width = 0, this.forced = null, this.host = e, this.breakpoint = t, e.addController(this);
	}
	get mobile() {
		return this.forced === null ? this.width > 0 && this.width <= this.breakpoint : this.forced;
	}
	setForced(e) {
		this.forced !== e && (this.forced = e, this.host.requestUpdate());
	}
	setWidth(e) {
		let t = this.mobile;
		this.width = e, this.mobile !== t && this.host.requestUpdate();
	}
	hostConnected() {
		typeof ResizeObserver > "u" || (this.observer = new ResizeObserver((e) => {
			let t = e[0];
			if (!t) return;
			let n = t.contentRect ?? t.target.getBoundingClientRect();
			this.setWidth(n.width);
		}), this.observer.observe(this.host));
	}
	hostDisconnected() {
		this.observer?.disconnect(), this.observer = void 0;
	}
};
//#endregion
//#region src/utils/debounce.ts
function nn(e, t) {
	let n;
	return (...r) => {
		n !== void 0 && window.clearTimeout(n), n = window.setTimeout(() => e(...r), t);
	};
}
//#endregion
//#region src/ui/empty-state.ts
function rn(e) {
	if (e?.degraded.connectionLost) return "connection-lost";
	let t = e?.filters ?? x();
	return t.locationId && S(t) === 1 ? "empty-location" : S(t) > 0 ? "no-matches" : "no-items";
}
function an(e, t) {
	switch (e) {
		case "connection-lost": return {
			headline: "Can't reach Home Assistant",
			detail: "The list will fill in once the connection is back.",
			offers: [{
				id: "refresh",
				label: "Try again"
			}]
		};
		case "no-matches": return {
			headline: "No items match these filters",
			offers: [{
				id: "clear-filters",
				label: "Clear all"
			}]
		};
		case "empty-location": return {
			headline: `Nothing in ${t ?? "this location"}`,
			offers: [{
				id: "add-item",
				label: "Add item here"
			}, {
				id: "clear-filters",
				label: "Show everything"
			}]
		};
		default: return {
			headline: "No items yet",
			detail: "Add your first item, or restore a backup.",
			offers: [{
				id: "add-item",
				label: "Add your first item"
			}, {
				id: "import",
				label: "Import backup"
			}]
		};
	}
}
function on(e, t) {
	let n = an(e, t.locationName);
	return v`<div class="empty" role="status" data-testid="empty-state" data-kind=${e}>
    <span class="headline">${n.headline}</span>
    ${n.detail ? v`<span>${n.detail}</span>` : null}
    <div class="offers">
      ${n.offers.map((e, n) => v`<button
          class=${n === 0 ? "hv-pill" : "hv-pill outline"}
          data-testid="empty-action"
          data-id=${e.id}
          @click=${() => t.onAction(e.id)}
        >
          ${e.label}
        </button>`)}
    </div>
  </div>`;
}
//#endregion
//#region src/components/hv-banner.ts
var sn, cn = {
	warning: "alert",
	error: "alertCircle",
	info: "refresh",
	success: "checkCircle"
}, ln = (sn = class extends b {
	constructor(...e) {
		super(...e), this.kind = "warning", this.heading = null, this.message = "", this.glyph = null;
	}
	render() {
		let e = cn[this.kind] ? this.kind : "warning";
		return v`
      <div class="banner ${e}" role="alert" data-testid="banner" data-kind=${e}>
        <span class="glyph">${j(this.glyph ?? cn[e], 18)}</span>
        <div class="body">
          ${this.heading ? v`<span class="heading">${this.heading}</span> ` : null}<span
            data-testid="banner-message"
            >${this.message}</span
          ><slot></slot>
          <slot name="below"></slot>
        </div>
        <div class="actions"><slot name="actions"></slot></div>
      </div>
    `;
	}
}, sn.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .banner {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 11px 13px;
        border-radius: var(--hv-radius-input);
        font-size: 12.5px;
        line-height: 1.5;
      }
      .banner.warning {
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
      }
      .banner.warning .glyph {
        color: var(--hv-warn);
      }
      .banner.error {
        background: var(--hv-error-bg);
        color: var(--hv-error-deep);
      }
      .banner.error .glyph {
        color: var(--hv-error);
      }
      .banner.info {
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
      }
      .banner.info .glyph {
        color: var(--hv-primary-dark);
      }
      .banner.success {
        background: var(--hv-primary-tint);
        color: var(--hv-success);
      }
      .banner.success .glyph {
        color: var(--hv-success);
      }
      .glyph {
        flex: none;
        margin-top: 1px;
      }
      .body {
        flex: 1;
        min-width: 0;
      }
      .heading {
        font-weight: 500;
      }
      slot[name='below'] {
        display: flex;
        gap: 8px;
      }
      /* Spacing lives on the slotted children so an empty slot adds nothing. */
      slot[name='below']::slotted(*) {
        margin-top: 8px;
      }
      .actions {
        flex: none;
        display: flex;
        align-items: center;
        gap: 6px;
      }
    `
], sn);
N([E({ type: String })], ln.prototype, "kind", void 0), N([E({ type: String })], ln.prototype, "heading", void 0), N([E({ type: String })], ln.prototype, "message", void 0), N([E({ attribute: !1 })], ln.prototype, "glyph", void 0), ln = N([T("hv-banner")], ln);
//#endregion
//#region src/components/hv-bottom-sheet.ts
var un, F = (un = class extends b {
	constructor(...e) {
		super(...e), this.open = !1, this.label = "Details", this.noHandle = !1, this._zBase = null, this._dragY = 0, this._dragFrom = null, this._dragStartedAt = 0, this._cancel = () => {
			this.open = !1, this.dispatchEvent(new CustomEvent("cancel", {
				bubbles: !0,
				composed: !0
			}));
		}, this._onGripDown = (e) => {
			this._dragFrom = e.clientY, this._dragStartedAt = e.timeStamp, e.currentTarget.setPointerCapture?.(e.pointerId);
		}, this._onGripMove = (e) => {
			this._dragFrom !== null && (this._dragY = Math.max(0, e.clientY - this._dragFrom));
		}, this._onGripUp = (e) => {
			if (this._dragFrom === null) return;
			let t = this._dragY, n = Math.max(1, e.timeStamp - this._dragStartedAt);
			this._dragFrom = null, this._dragY = 0;
			let r = this.renderRoot.querySelector(".sheet")?.offsetHeight ?? 0, i = t > Math.max(80, r * .25), a = t > 24 && t / n > .5;
			(i || a) && this._cancel();
		};
	}
	willUpdate(e) {
		e.has("open") && (this.open && (this._zBase = M()), this._dragFrom = null, this._dragY = 0);
	}
	render() {
		if (!this.open) return null;
		let e = this._zBase ?? 9998, t = this._dragY > 0 ? ` transform: translateY(${this._dragY}px); transition: none;` : "";
		return v`
      <div class="scrim" role="presentation" style="z-index: ${e};" @click=${this._cancel}></div>
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-label=${this.label}
        data-testid="bottom-sheet"
        style="z-index: ${e + 1};${t}"
        @keydown=${A(() => this._cancel())}
      >
        ${this.noHandle ? null : v`<div
              class="grip"
              data-testid="sheet-grip"
              aria-hidden="true"
              @pointerdown=${this._onGripDown}
              @pointermove=${this._onGripMove}
              @pointerup=${this._onGripUp}
              @pointercancel=${this._onGripUp}
            >
              <div class="handle" data-testid="sheet-handle"></div>
            </div>`}
        <div class="body"><slot></slot></div>
        <slot name="footer"></slot>
      </div>
    `;
	}
}, un.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .scrim {
        position: fixed;
        inset: 0;
        background: var(--hv-scrim);
      }
      .sheet {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        /* The sheet is fixed to the viewport, not to the card that opened it,
           so on a desktop dashboard it would run the full screen width — 48px
           fact rows with the value flung to the far edge, and action buttons a
           metre wide. Cap it and let the auto margins centre it; on a phone
           min() resolves to 100% and this is a no-op. */
        width: min(100%, var(--hv-sheet-max-width, 640px));
        margin-inline: auto;
        /* dvh, not vh: on a phone vh resolves against the viewport with the
           browser chrome retracted, so a sheet at its cap could stand taller
           than the screen actually showing and push its sticky footer — the
           Cancel and "Show N items" buttons — under the URL bar. dvh tracks
           the viewport that is really visible. */
        max-height: 92dvh;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-top: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-sheet) var(--hv-radius-sheet) 0 0;
        box-shadow: var(--hv-shadow-sheet);
        animation: rise var(--hv-motion-sheet) var(--hv-ease-out);
      }
      @keyframes rise {
        from {
          transform: translateY(16px);
          opacity: 0;
        }
        to {
          transform: none;
          opacity: 1;
        }
      }
      /* The bar is 36x4; the area you can actually grab has to be a lot bigger
         than that. touch-action: none matters as much as the size — without it
         the browser claims the gesture as a scroll and no pointermove ever
         arrives. */
      .grip {
        flex: none;
        display: grid;
        place-items: center;
        padding: 8px 0 4px;
        touch-action: none;
        cursor: grab;
      }
      .grip:active {
        cursor: grabbing;
      }
      .handle {
        width: 36px;
        height: 4px;
        border-radius: 2px;
        background: var(--hv-divider);
      }
      .body {
        overflow-y: auto;
        overscroll-behavior: contain;
        flex: 1;
        min-height: 0;
      }
      slot[name='footer'] {
        display: block;
        flex: none;
        border-top: 1px solid var(--hv-row-divider);
        background: var(--hv-surface);
      }
    `
], un);
N([E({
	type: Boolean,
	reflect: !0
})], F.prototype, "open", void 0), N([E({ type: String })], F.prototype, "label", void 0), N([E({ type: Boolean })], F.prototype, "noHandle", void 0), N([D()], F.prototype, "_zBase", void 0), N([D()], F.prototype, "_dragY", void 0), F = N([T("hv-bottom-sheet")], F);
//#endregion
//#region src/components/hv-confirm.ts
var dn, I = (dn = class extends b {
	constructor(...e) {
		super(...e), this.open = !1, this.heading = "Are you sure?", this.message = "", this.warning = null, this.confirmLabel = "Confirm", this.cancelLabel = "Cancel", this.destructive = !1, this._zBase = null, this._cancel = () => {
			this.open = !1, this.dispatchEvent(new CustomEvent("cancel", {
				bubbles: !0,
				composed: !0
			}));
		}, this._confirm = () => {
			this.open = !1, this.dispatchEvent(new CustomEvent("confirm", {
				bubbles: !0,
				composed: !0
			}));
		};
	}
	willUpdate(e) {
		e.has("open") && this.open && (this._zBase = M());
	}
	updated(e) {
		e.has("open") && this.open && (this.shadowRoot?.querySelector("[data-testid=\"confirm-accept\"]"))?.focus();
	}
	render() {
		if (!this.open) return null;
		let e = this._zBase ?? 9998;
		return v`
      <div class="backdrop" role="presentation" style="z-index: ${e};" @click=${this._cancel}></div>
      <div class="wrap" role="none" style="z-index: ${e + 1};">
        <div
          class="panel"
          role="alertdialog"
          aria-modal="true"
          aria-label=${this.heading}
          data-testid="confirm-dialog"
          @keydown=${A(() => this._cancel())}
        >
          <h2>${this.heading}</h2>
          ${this.message ? v`<div class="message" data-testid="confirm-message">${this.message}</div>` : null}
          ${this.warning ? v`<div class="warning">
                <hv-banner kind="error" .message=${this.warning} data-testid="confirm-warning"></hv-banner>
              </div>` : null}
          <div class="actions">
            <button class="hv-text-button" data-testid="confirm-cancel" @click=${this._cancel}>
              ${this.cancelLabel}
            </button>
            <button
              class="confirm ${this.destructive ? "destructive" : ""}"
              data-testid="confirm-accept"
              @click=${this._confirm}
            >
              ${this.destructive ? j("del", 15) : null}${this.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    `;
	}
}, dn.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
      }
      .wrap {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 16px;
        box-sizing: border-box;
      }
      .panel {
        width: 330px;
        max-width: 100%;
        box-sizing: border-box;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: var(--hv-radius-dialog);
        box-shadow: var(--hv-shadow-dialog);
        overflow: hidden;
      }
      h2 {
        margin: 0;
        padding: 14px 18px 8px;
        font-size: 15px;
        font-weight: 500;
      }
      .message {
        padding: 0 18px 14px;
        font-size: 13px;
        line-height: 1.5;
        color: var(--hv-text-secondary);
      }
      .warning {
        padding: 0 18px 14px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        padding: 0 14px 14px;
      }
      .confirm {
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        border: none;
        border-radius: var(--hv-radius-chip);
        padding: 8px 18px;
        font: 500 13px var(--hv-font);
      }
      .confirm.destructive {
        background: var(--hv-error);
      }
      .confirm:hover {
        opacity: 0.9;
      }
    `
], dn);
N([E({
	type: Boolean,
	reflect: !0
})], I.prototype, "open", void 0), N([E({ type: String })], I.prototype, "heading", void 0), N([E({ type: String })], I.prototype, "message", void 0), N([E({ type: String })], I.prototype, "warning", void 0), N([E({ type: String })], I.prototype, "confirmLabel", void 0), N([E({ type: String })], I.prototype, "cancelLabel", void 0), N([E({ type: Boolean })], I.prototype, "destructive", void 0), N([D()], I.prototype, "_zBase", void 0), I = N([T("hv-confirm")], I);
//#endregion
//#region src/ui/location-path.ts
function fn(e) {
	return e.replace(/\s*\/\s*/g, " › ");
}
function pn(e, t) {
	return e ? fn(e.path?.display_path ?? e.name) : t;
}
//#endregion
//#region src/ui/relative-time.ts
var mn = 6e4, hn = 60 * mn, gn = 24 * hn, _n = 7 * gn, vn = 365 * gn;
function yn(e) {
	if (!e) return null;
	let t = Date.parse(e);
	return Number.isNaN(t) ? null : t;
}
function bn(e, t = Date.now()) {
	let n = yn(e);
	if (n === null) return "—";
	let r = t - n;
	return r < 0 || r < mn ? "just now" : r < hn ? `${Math.floor(r / mn)} m ago` : r < gn ? `${Math.floor(r / hn)} h ago` : r < _n ? `${Math.floor(r / gn)} d ago` : r < vn ? `${Math.floor(r / _n)} w ago` : `${Math.floor(r / vn)} y ago`;
}
var xn = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec"
];
function L(e, t = Date.now()) {
	if (!e) return "—";
	let n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e);
	if (!n) return e;
	let [, r, i, a] = n, o = xn[Number(i) - 1];
	if (!o) return e;
	let s = String(Number(a));
	return Number(r) === new Date(t).getFullYear() ? `${o} ${s}` : `${o} ${s}, ${r}`;
}
function R(e, t = Date.now()) {
	return e ? e < Sn(t) : !1;
}
function Sn(e = Date.now()) {
	let t = new Date(e), n = (e) => String(e).padStart(2, "0");
	return `${t.getFullYear()}-${n(t.getMonth() + 1)}-${n(t.getDate())}`;
}
function z(e, t = Date.now()) {
	return Sn(t + e * gn);
}
var Cn = [
	{
		days: 7,
		label: "+7 days"
	},
	{
		days: 31,
		label: "+31 days"
	},
	{
		days: 90,
		label: "+90 days"
	}
], wn;
function Tn(e, t = {}) {
	let n = [];
	if (e.q && n.push({
		key: "q",
		label: `"${e.q}"`,
		tone: "primary"
	}), e.locationId) {
		let r = pn((t.locations ?? []).find((t) => t.id === e.locationId), "Location");
		n.push({
			key: "locationId",
			label: e.includeSubtree ? `${r} + sub` : r,
			tone: "primary"
		});
	}
	if (e.areaId) {
		let r = (t.areas ?? []).find((t) => t.id === e.areaId);
		n.push({
			key: "areaId",
			label: `Area: ${r?.name ?? e.areaId}`,
			tone: "primary"
		});
	}
	if (e.category && n.push({
		key: "category",
		label: e.category,
		tone: "primary"
	}), e.tags.length) {
		let t = e.tags.join(", ");
		n.push({
			key: "tags",
			label: e.tagsMode === "all" ? `all of: ${t}` : `any of: ${t}`,
			tone: "primary"
		});
	}
	e.lowStockOnly && n.push({
		key: "lowStockOnly",
		label: "Low stock only",
		tone: "warning"
	}), e.lowStockFirst && n.push({
		key: "lowStockFirst",
		label: "Low stock first",
		tone: "primary"
	}), e.checkedOutOnly && n.push({
		key: "checkedOutOnly",
		label: "Checked out",
		tone: "primary"
	}), e.overdueOnly && n.push({
		key: "overdueOnly",
		label: "Overdue",
		tone: "warning"
	}), e.inspectionDueOnly && n.push({
		key: "inspectionDueOnly",
		label: "Inspection due",
		tone: "warning"
	}), e.orphansOnly && n.push({
		key: "orphansOnly",
		label: "No location",
		tone: "primary"
	});
	let r = [
		[
			"updatedAfter",
			e.updatedAfter,
			"Updated ≥"
		],
		[
			"updatedBefore",
			e.updatedBefore,
			"Updated ≤"
		],
		[
			"createdAfter",
			e.createdAfter,
			"Created ≥"
		],
		[
			"createdBefore",
			e.createdBefore,
			"Created ≤"
		]
	];
	for (let [e, t, i] of r) t && n.push({
		key: e,
		label: `${i} ${L(t.slice(0, 10))}`,
		tone: "primary"
	});
	return n;
}
function En(e) {
	switch (e) {
		case "q": return { q: "" };
		case "tags": return { tags: [] };
		case "areaId":
		case "locationId":
		case "category":
		case "updatedAfter":
		case "createdAfter":
		case "updatedBefore":
		case "createdBefore": return { [e]: null };
		default: return { [e]: !1 };
	}
}
var Dn = (wn = class extends b {
	constructor(...e) {
		super(...e), this.locations = null, this.areas = [];
	}
	render() {
		if (!this.filters) return null;
		let e = Tn(this.filters, {
			locations: this.locations,
			areas: this.areas
		});
		return e.length ? v`
      <div class="row" data-testid="filter-chips">
        ${e.map((e) => v`<button
            class="chip ${e.tone === "warning" ? "warning" : ""}"
            data-testid="filter-chip"
            data-key=${e.key}
            aria-label=${`Clear filter ${e.label}`}
            @click=${() => this.dispatchEvent(new CustomEvent("remove-filter", {
			detail: {
				key: e.key,
				patch: En(e.key)
			},
			bubbles: !0,
			composed: !0
		}))}
          >
            ${e.label}${j("close", 15)}
          </button>`)}
        <button
          class="clear-all"
          data-testid="filter-chips-clear"
          @click=${() => this.dispatchEvent(new CustomEvent("clear-filters", {
			bubbles: !0,
			composed: !0
		}))}
        >
          Clear all
        </button>
      </div>
    ` : null;
	}
}, wn.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: none;
        border-radius: var(--hv-radius-chip);
        padding: 4px 9px 4px 11px;
        font: 500 12px var(--hv-font);
        color: var(--hv-primary-darker);
        background: var(--hv-primary-tint);
      }
      .chip.warning {
        color: var(--hv-warn);
        background: var(--hv-warn-bg);
      }
      .chip:hover {
        opacity: 0.85;
      }
      .chip svg {
        opacity: 0.8;
      }
      .clear-all {
        border: none;
        background: none;
        font: 500 12px var(--hv-font);
        color: var(--hv-text-secondary);
        padding: 4px 6px;
      }
      .clear-all:hover {
        color: var(--hv-primary-dark);
      }
    `
], wn);
N([E({ attribute: !1 })], Dn.prototype, "filters", void 0), N([E({ attribute: !1 })], Dn.prototype, "locations", void 0), N([E({ attribute: !1 })], Dn.prototype, "areas", void 0), Dn = N([T("hv-filter-chips")], Dn);
//#endregion
//#region src/components/hv-location-tree.ts
var On, B = (On = class extends b {
	constructor(...e) {
		super(...e), this.nodes = [], this.selectedId = null, this.showAll = !1, this.allLabel = "All items", this.allIcon = "home", this.showOrphans = !1, this.orphansSelected = !1, this.totalCount = null, this.orphanCount = null, this.matchingTotalCount = null, this.showCounts = !1, this.showAreas = !1, this.manage = !1, this.mobile = !1, this.excludeSubtreeOf = null, this.filterText = "", this.areas = [], this._expanded = /* @__PURE__ */ new Set();
	}
	revealPathTo(e) {
		if (!e) return;
		let t = this._findPath(this.nodes, e) ?? [], n = new Set(this._expanded);
		for (let e of t.slice(0, -1)) n.add(e.id);
		this._expanded = n;
	}
	_findPath(e, t) {
		for (let n of e) {
			if (n.id === t) return [n];
			let e = this._findPath(n.children ?? [], t);
			if (e) return [n, ...e];
		}
		return null;
	}
	_toggle(e) {
		let t = new Set(this._expanded);
		t.has(e) ? t.delete(e) : t.add(e), this._expanded = t;
	}
	_emit(e, t) {
		this.dispatchEvent(new CustomEvent(e, {
			detail: t,
			bubbles: !0,
			composed: !0
		}));
	}
	_matches(e) {
		return tt(e, this.filterText);
	}
	_visible(e) {
		return this._matches(e) ? !0 : (e.children ?? []).some((e) => this._visible(e));
	}
	_areaName(e) {
		return e ? this.areas.find((t) => t.id === e)?.name ?? e : null;
	}
	_renderCount(e, t) {
		let n = e.subtree_item_count ?? e.direct_item_count ?? 0;
		if (!this.manage) {
			let t = e.matching_subtree_count;
			return v`<span class="count" data-testid="tree-count"
        >${t === void 0 ? n : `${t} / ${n}`}</span
      >`;
		}
		return v`<button
      class="count link"
      data-testid="tree-count"
      data-id=${e.id}
      ?disabled=${t}
      @click=${(n) => {
			n.stopPropagation(), !t && this._emit("select", {
				locationId: e.id,
				node: e
			});
		}}
    >
      ${P(n, "item")}
    </button>`;
	}
	_renderNode(e, t, n) {
		if (!this._visible(e)) return null;
		let r = (e.children ?? []).filter((e) => this._visible(e)), i = r.length > 0, a = this.filterText.trim().length > 0 || this._expanded.has(e.id), o = n || e.id === this.excludeSubtreeOf, s = !this.orphansSelected && this.selectedId === e.id, c = this.showAreas ? this._areaName(e.area_id) : null;
		return v`
      <div>
        <div
          class="row ${s ? "selected" : ""} ${this.manage ? "manage" : ""} ${this.mobile ? "touch" : ""}"
          role="treeitem"
          aria-selected=${String(s)}
          aria-expanded=${i ? String(a) : "undefined"}
          data-testid="tree-row"
          data-id=${e.id}
          data-depth=${t}
          ?disabled=${o}
          style="padding-left: ${12 + t * 18}px"
        >
          ${i ? v`<button
                class="twisty"
                data-testid="tree-twisty"
                aria-label=${a ? `Collapse ${e.name}` : `Expand ${e.name}`}
                @click=${(t) => {
			t.stopPropagation(), this._toggle(e.id);
		}}
              >
                ${j(a ? "chevronDown" : "chevronRight", 17)}
              </button>` : v`<span class="twisty placeholder">${j("chevronRight", 17)}</span>`}
          <button
            class="name"
            data-testid="tree-select"
            data-id=${e.id}
            title=${e.path?.display_path ?? e.name}
            ?disabled=${o}
            style="border:none;background:none;padding:0;font:inherit;color:inherit;text-align:left"
            @click=${() => {
			o || this._emit("select", {
				locationId: e.id,
				node: e
			});
		}}
          >
            ${e.name}
          </button>
          ${c ? v`<span class="area-chip" data-testid="tree-area">Area: ${c}</span>` : null}
          ${this.showCounts ? this._renderCount(e, o) : null}
          ${this.manage && this.mobile ? v`<span class="actions">
                <button
                  class="action"
                  data-testid="tree-more"
                  data-id=${e.id}
                  aria-label=${`Actions for ${e.name}`}
                  @click=${(t) => {
			t.stopPropagation(), this._emit("more-location", {
				locationId: e.id,
				node: e
			});
		}}
                >
                  ${j("dotsVertical", 17)}
                </button>
              </span>` : null}
          ${this.manage && !this.mobile ? v`<span class="actions">
                <button
                  class="action"
                  data-testid="tree-merge"
                  data-id=${e.id}
                  aria-label=${`Merge ${e.name}`}
                  title="Merge into another location"
                  @click=${(t) => {
			t.stopPropagation(), this._emit("merge-location", {
				locationId: e.id,
				node: e
			});
		}}
                >
                  ${j("callMerge", 16)}
                </button>
                <button
                  class="action"
                  data-testid="tree-edit"
                  data-id=${e.id}
                  aria-label=${`Edit ${e.name}`}
                  title="Edit location"
                  @click=${(t) => {
			t.stopPropagation(), this._emit("edit-location", {
				locationId: e.id,
				node: e
			});
		}}
                >
                  ${j("pencil", 16)}
                </button>
                <button
                  class="action danger"
                  data-testid="tree-delete"
                  data-id=${e.id}
                  aria-label=${`Delete ${e.name}`}
                  title="Delete location"
                  @click=${(t) => {
			t.stopPropagation(), this._emit("delete-location", {
				locationId: e.id,
				node: e
			});
		}}
                >
                  ${j("del", 16)}
                </button>
              </span>` : null}
        </div>
        <slot name=${`after-${e.id}`}></slot>
        ${a ? r.map((e) => this._renderNode(e, t + 1, o)) : null}
      </div>
    `;
	}
	_pairedCount(e, t) {
		return v`<span class="count">${t === null ? e : `${t} / ${e}`}</span>`;
	}
	get _matchingOrphanCount() {
		if (this.matchingTotalCount === null) return null;
		let e = this.nodes.reduce((e, t) => e + (t.matching_subtree_count ?? 0), 0);
		return Math.max(0, this.matchingTotalCount - e);
	}
	render() {
		let e = this.nodes.map((e) => this._renderNode(e, 0, !1)).filter(Boolean);
		return v`
      <div role="tree" aria-label="Locations">
        ${this.showAll ? v`<button
              class="row ${!this.orphansSelected && this.selectedId === null ? "selected" : ""}"
              data-testid="tree-all"
              @click=${() => this._emit("select", {
			locationId: null,
			node: null
		})}
            >
              <span class="twisty placeholder">${j("chevronRight", 17)}</span>
              ${j(this.allIcon, 18)}
              <span class="name">${this.allLabel}</span>
              ${this.showCounts && this.totalCount !== null ? this._pairedCount(this.totalCount, this.matchingTotalCount) : null}
            </button>` : null}
        ${e.length ? e : v`<div class="empty" data-testid="tree-empty">
              ${this.filterText.trim() ? "No locations match" : "No locations yet"}
            </div>`}
        ${this.showOrphans ? v`
              <div class="divider"></div>
              <button
                class="row orphans ${this.orphansSelected ? "selected" : ""}"
                data-testid="tree-orphans"
                @click=${() => this._emit("select-orphans", {})}
              >
                <span class="twisty placeholder">${j("chevronRight", 17)}</span>
                ${j("alert", 18)}
                <span class="name">No location</span>
                ${this.showCounts && this.orphanCount !== null ? this._pairedCount(this.orphanCount, this._matchingOrphanCount) : null}
              </button>
            ` : null}
      </div>
    `;
	}
}, On.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        box-sizing: border-box;
        border: none;
        background: none;
        text-align: left;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
        padding: 7px 12px;
        border-radius: var(--hv-radius-input);
      }
      .row:hover {
        background: var(--hv-hover-overlay);
      }
      .row.selected {
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
        font-weight: 500;
        box-shadow: inset -3px 0 0 0 var(--hv-primary);
      }
      .row.orphans {
        color: var(--hv-warn);
      }
      .row[disabled] {
        opacity: 0.4;
        cursor: default;
      }
      .twisty {
        flex: none;
        display: inline-grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border: none;
        background: none;
        border-radius: 50%;
        color: var(--hv-text-tertiary);
        padding: 0;
      }
      .twisty:hover {
        background: var(--hv-hover-overlay);
      }
      .twisty.placeholder {
        visibility: hidden;
      }
      .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .count {
        flex: none;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      .row.selected .count {
        color: inherit;
      }
      /* Managing is browsing too: the count is the way into the items, exactly
         as it is on the organize dialog's category and tag rows. */
      .count.link {
        border: none;
        background: none;
        padding: 0 2px;
        font: 400 12px var(--hv-font);
        color: var(--hv-primary-dark);
      }
      .count.link:hover {
        text-decoration: underline;
      }
      /* Left-packed like a value row (name, then count) instead of the name
         pushing the count to the far edge. */
      .row.manage .name {
        flex: 0 1 auto;
      }
      .row.manage .actions {
        margin-left: auto;
      }
      .area-chip {
        flex: none;
        font-size: 11px;
        color: var(--hv-chip-text);
        background: var(--hv-chip-bg);
        border-radius: var(--hv-radius-chip);
        padding: 2px 8px;
      }
      .actions {
        flex: none;
        display: flex;
        gap: 2px;
      }
      /* Reveal-on-hover only where hovering exists, or a touch screen could
         never reach these at all. Hidden rather than unrendered, so the rest of
         the row does not jump sideways the moment the pointer arrives. */
      @media (hover: hover) {
        .actions {
          visibility: hidden;
        }
        .row:hover .actions,
        .row:focus-within .actions,
        /* The touch layout's single ⋮ is the only way in — never hide it. */
        .row.touch .actions {
          visibility: visible;
        }
      }
      .action {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--hv-primary-dark);
        padding: 0;
      }
      .action.danger {
        color: var(--hv-error);
      }
      .action:hover {
        background: var(--hv-hover-overlay);
      }
      .empty {
        padding: 10px 12px;
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
      }
      .divider {
        height: 1px;
        background: var(--hv-row-divider);
        margin: 6px 0;
      }
    `
], On);
N([E({ attribute: !1 })], B.prototype, "nodes", void 0), N([E({ type: String })], B.prototype, "selectedId", void 0), N([E({ type: Boolean })], B.prototype, "showAll", void 0), N([E({ type: String })], B.prototype, "allLabel", void 0), N([E({ type: String })], B.prototype, "allIcon", void 0), N([E({ type: Boolean })], B.prototype, "showOrphans", void 0), N([E({ type: Boolean })], B.prototype, "orphansSelected", void 0), N([E({ type: Number })], B.prototype, "totalCount", void 0), N([E({ type: Number })], B.prototype, "orphanCount", void 0), N([E({ type: Number })], B.prototype, "matchingTotalCount", void 0), N([E({ type: Boolean })], B.prototype, "showCounts", void 0), N([E({ type: Boolean })], B.prototype, "showAreas", void 0), N([E({ type: Boolean })], B.prototype, "manage", void 0), N([E({ type: Boolean })], B.prototype, "mobile", void 0), N([E({ type: String })], B.prototype, "excludeSubtreeOf", void 0), N([E({ type: String })], B.prototype, "filterText", void 0), N([E({ attribute: !1 })], B.prototype, "areas", void 0), N([D()], B.prototype, "_expanded", void 0), B = N([T("hv-location-tree")], B);
//#endregion
//#region src/components/hv-filter-panel.ts
var kn, An = [
	{
		field: "updated_at",
		label: "Updated"
	},
	{
		field: "created_at",
		label: "Created"
	},
	{
		field: "name",
		label: "Name"
	},
	{
		field: "quantity",
		label: "Quantity"
	},
	{
		field: "due_date",
		label: "Due date"
	},
	{
		field: "inspection_date",
		label: "Next inspection"
	}
], jn = 4, Mn = {
	updated: {
		after: "updatedAfter",
		before: "updatedBefore",
		noun: "Updated"
	},
	created: {
		after: "createdAfter",
		before: "createdBefore",
		noun: "Created"
	}
}, V = (kn = class extends b {
	constructor(...e) {
		super(...e), this.distinct = null, this.areas = [], this.locations = null, this.locationTree = [], this.total = null, this.grandTotal = null, this.mobile = !1, this.counts = null, this._draft = null, this._locationOpen = !1, this._showAllCategories = !1, this._tagDraft = "", this._dateDirection = {
			updated: "after",
			created: "after"
		};
	}
	get working() {
		return this.mobile ? this._draft ?? this.filters : this.filters;
	}
	willUpdate(e) {
		this.mobile && (e.has("filters") || e.has("mobile")) && !this._draft && (this._draft = {
			...this.filters,
			tags: [...this.filters.tags]
		}), !this.mobile && e.has("mobile") && (this._draft = null);
	}
	resetDraft() {
		this._draft = this.mobile ? {
			...this.filters,
			tags: [...this.filters.tags]
		} : null;
	}
	clearAll() {
		if (!this.mobile) {
			this.dispatchEvent(new CustomEvent("clear-filters", {
				bubbles: !0,
				composed: !0
			}));
			return;
		}
		this._patch({
			...x(),
			sort: this.working.sort
		});
	}
	_patch(e) {
		if (this.mobile) {
			this._draft = {
				...this.working,
				...e
			}, this.dispatchEvent(new CustomEvent("stage", {
				detail: { filters: this._draft },
				bubbles: !0,
				composed: !0
			}));
			return;
		}
		this.dispatchEvent(new CustomEvent("change", {
			detail: e,
			bubbles: !0,
			composed: !0
		}));
	}
	apply() {
		let e = this._draft;
		this._draft = null, e && this.dispatchEvent(new CustomEvent("apply", {
			detail: e,
			bubbles: !0,
			composed: !0
		}));
	}
	_toggleTag(e) {
		let t = this.working.tags, n = t.includes(e) ? t.filter((t) => t !== e) : [...t, e];
		this._patch({ tags: n });
	}
	_commitTagDraft() {
		let e = this._tagDraft.trim().toLowerCase();
		this._tagDraft = "", !(!e || this.working.tags.includes(e)) && this._patch({ tags: [...this.working.tags, e] });
	}
	_renderCheckbox(e, t, n, r = {}) {
		return v`<button
      class="check"
      role="checkbox"
      aria-checked=${String(t)}
      data-testid=${r.testid ?? "filter-check"}
      @click=${n}
    >
      <span class="box ${t ? "on" : ""} ${r.warning ? "warning" : ""}">
        ${t ? j("check", this.mobile ? 15 : 12) : null}
      </span>
      <span>${e}</span>
      ${r.tally !== void 0 && r.tally !== null ? v`<span class="tally-right">${r.tally}</span>` : null}
    </button>`;
	}
	_renderLocationGroup() {
		let e = this.working, t = pn((this.locations ?? []).find((t) => t.id === e.locationId), "Any location");
		return v`
      <div class="group">
        <span class="hv-label">Where</span>
        <div class="chips">
          <button
            class="chip ${e.locationId ? "on" : ""}"
            data-testid="filter-location"
            aria-expanded=${String(this._locationOpen)}
            @click=${() => {
			this._locationOpen = !this._locationOpen;
		}}
          >
            ${j("mapMarker", 14)}${t}${j("chevronDown", 14)}
          </button>
          <label class="field select-field ${e.areaId ? "on" : ""}" data-testid="filter-area">
            <span class="hv-sr-only">Area</span>
            <select
              .value=${e.areaId ?? ""}
              @change=${(e) => this._patch({ areaId: e.target.value || null })}
            >
              <option value="">Area: Any</option>
              ${this.areas.map((t) => v`<option value=${t.id} ?selected=${e.areaId === t.id}>${t.name}</option>`)}
            </select>
            <span class="chevron">${j("chevronDown", 14)}</span>
          </label>
          ${this._renderCheckbox("Include sub-locations", e.includeSubtree, () => this._patch({ includeSubtree: !e.includeSubtree }), { testid: "filter-include-subtree" })}
        </div>
        ${this._locationOpen ? v`<div class="tree-holder">
              <hv-location-tree
                data-testid="filter-location-tree"
                .nodes=${this.locationTree}
                .selectedId=${e.locationId}
                showAll
                showCounts
                .totalCount=${this.grandTotal}
                @select=${(e) => {
			this._patch({ locationId: e.detail.locationId }), this._locationOpen = !1;
		}}
              ></hv-location-tree>
            </div>` : null}
      </div>
    `;
	}
	_renderCategoryGroup() {
		let e = this.working, t = this.distinct?.categories ?? [], n = this._showAllCategories ? t : t.slice(0, jn), r = t.length - n.length;
		return t.length ? v`
      <div class="group">
        <span class="hv-label">Category</span>
        <div class="chips">
          ${n.map((t) => v`<button
              class="chip ${e.category === t.value ? "on" : ""}"
              data-testid="filter-category"
              data-value=${t.value}
              @click=${() => this._patch({ category: e.category === t.value ? null : t.value })}
            >
              ${e.category === t.value ? j("check", 12) : null}${t.value}
              <span class="tally">${t.count}</span>
            </button>`)}
          ${r > 0 ? v`<button
                class="chip more"
                data-testid="filter-category-more"
                @click=${() => {
			this._showAllCategories = !0;
		}}
              >
                More… <span class="tally">${r}</span>
              </button>` : null}
        </div>
        <span class="hint">Single select · counts from distinct values</span>
      </div>
    ` : null;
	}
	_renderTagGroup() {
		let e = this.working, t = this.distinct?.tags ?? [], n = new Set(e.tags), r = t.map((e) => e.value), i = e.tags.filter((e) => !r.includes(e));
		return v`
      <div class="group">
        <div class="group-head">
          <span class="hv-label">Tags</span>
          <!-- Beside its own heading, not pushed to the far edge: an auto margin
               parked Any/All against the right rim of a full-width panel, a
               screen's width from the word it qualifies and directly above an
               unrelated row. The Sort group's direction toggle already sits next
               to what it sorts, so this matches it. -->
          <span class="segmented" role="radiogroup" aria-label="Tag match mode">
            ${["any", "all"].map((t) => v`<button
                class=${e.tagsMode === t ? "on" : ""}
                role="radio"
                aria-checked=${String(e.tagsMode === t)}
                data-testid="filter-tags-mode"
                data-mode=${t}
                @click=${() => this._patch({ tagsMode: t })}
              >
                ${t === "any" ? "Any" : "All"}
              </button>`)}
          </span>
        </div>
        <div class="chips">
          ${t.map((e) => v`<button
              class="chip ${n.has(e.value) ? "on" : ""}"
              data-testid="filter-tag"
              data-value=${e.value}
              @click=${() => this._toggleTag(e.value)}
            >
              ${n.has(e.value) ? j("check", 12) : null}${e.value}
              <span class="tally">${e.count}</span>
            </button>`)}
          ${i.map((e) => v`<button
              class="chip on"
              data-testid="filter-tag"
              data-value=${e}
              @click=${() => this._toggleTag(e)}
            >
              ${j("check", 12)}${e}
            </button>`)}
          <label class="field" data-testid="filter-tag-add">
            <span class="hv-sr-only">Add tag</span>
            <input
              type="search"
              placeholder="+ add tag…"
              .value=${this._tagDraft}
              size="10"
              @input=${(e) => {
			this._tagDraft = e.target.value;
		}}
              @keydown=${(e) => {
			e.key === "Enter" && (e.preventDefault(), this._commitTagDraft());
		}}
              @blur=${() => this._commitTagDraft()}
            />
          </label>
        </div>
        <span class="hint">Stored lowercase — input lowercases on commit</span>
      </div>
    `;
	}
	_renderShowOnlyGroup() {
		let e = this.working, t = this.counts, n = (e) => e == null ? null : v`<span class="tally">${e}</span>`;
		return v`
      <div class="group">
        <span class="hv-label">Show only</span>
        <div class="chips">
          ${this.mobile ? v`
                ${this._renderCheckbox("Low stock", e.lowStockOnly, () => this._patch({ lowStockOnly: !e.lowStockOnly }), {
			warning: !0,
			tally: t?.low_stock_count,
			testid: "filter-low-stock-only"
		})}
                ${this._renderCheckbox("Checked out", e.checkedOutOnly, () => this._patch({ checkedOutOnly: !e.checkedOutOnly }), {
			tally: t?.checked_out_count,
			testid: "filter-checked-out"
		})}
                ${this._renderCheckbox("Overdue", e.overdueOnly, () => this._patch({ overdueOnly: !e.overdueOnly }), {
			warning: !0,
			tally: t?.overdue_count,
			testid: "filter-overdue"
		})}
                ${this._renderCheckbox("Inspection due", e.inspectionDueOnly, () => this._patch({ inspectionDueOnly: !e.inspectionDueOnly }), {
			warning: !0,
			tally: t?.inspection_overdue_count,
			testid: "filter-inspection-due"
		})}
                ${this._renderCheckbox("No location", e.orphansOnly, () => this._patch({ orphansOnly: !e.orphansOnly }), {
			tally: t?.no_location_count,
			testid: "filter-orphans"
		})}
              ` : v`
                <button
                  class="chip ${e.lowStockOnly ? "on warning" : ""}"
                  data-testid="filter-low-stock-only"
                  @click=${() => this._patch({ lowStockOnly: !e.lowStockOnly })}
                >
                  ${e.lowStockOnly ? j("check", 12) : null}Low stock${n(t?.low_stock_count)}
                </button>
                <button
                  class="chip ${e.checkedOutOnly ? "on" : ""}"
                  data-testid="filter-checked-out"
                  @click=${() => this._patch({ checkedOutOnly: !e.checkedOutOnly })}
                >
                  ${e.checkedOutOnly ? j("check", 12) : null}Checked out${n(t?.checked_out_count)}
                </button>
                <button
                  class="chip ${e.overdueOnly ? "on warning" : ""}"
                  data-testid="filter-overdue"
                  @click=${() => this._patch({ overdueOnly: !e.overdueOnly })}
                >
                  ${e.overdueOnly ? j("check", 12) : null}Overdue${n(t?.overdue_count)}
                </button>
                <button
                  class="chip ${e.inspectionDueOnly ? "on warning" : ""}"
                  data-testid="filter-inspection-due"
                  @click=${() => this._patch({ inspectionDueOnly: !e.inspectionDueOnly })}
                >
                  ${e.inspectionDueOnly ? j("check", 12) : null}Inspection due${n(t?.inspection_overdue_count)}
                </button>
                <button
                  class="chip ${e.orphansOnly ? "on" : ""}"
                  data-testid="filter-orphans"
                  @click=${() => this._patch({ orphansOnly: !e.orphansOnly })}
                >
                  ${e.orphansOnly ? j("check", 12) : null}No location${n(t?.no_location_count)}
                </button>
              `}
        </div>
      </div>
    `;
	}
	_dateDirectionOf(e) {
		let t = this.working;
		return t[Mn[e].before] ? "before" : t[Mn[e].after] ? "after" : this._dateDirection[e];
	}
	_renderDateRow(e) {
		let { after: t, before: n, noun: r } = Mn[e], i = this._dateDirectionOf(e) === "before", a = i ? n : t, o = this.working[a], s = (e) => e ? e.slice(0, 10) : "", c = (e) => e ? `${e}T00:00:00Z` : null;
		return v`<span class="field ${o ? "on" : "muted"}" data-testid=${`filter-${e}-date`}>
      ${j("calendar", 14)}
      <button
        class="direction"
        data-testid=${`filter-${e}-direction`}
        data-direction=${i ? "before" : "after"}
        aria-label=${`${r} ${i ? "before" : "since"} — switch to ${i ? "since" : "before"}`}
        title=${i ? "Before this date — click for \"since\"" : "Since this date — click for \"before\""}
        @click=${() => {
			this._dateDirection = {
				...this._dateDirection,
				[e]: i ? "after" : "before"
			}, o && this._patch({
				[t]: i ? o : null,
				[n]: i ? null : o
			});
		}}
      >
        ${r} ${i ? "≤" : "≥"}
      </button>
      <input
        type="date"
        aria-label=${`${r} ${i ? "before" : "since"}`}
        .value=${s(o)}
        @change=${(e) => this._patch({ [a]: c(e.target.value) })}
      />
    </span>`;
	}
	_renderDateGroup() {
		return v`
      <div class="group">
        <span class="hv-label">Changed</span>
        <div class="chips">${this._renderDateRow("updated")} ${this._renderDateRow("created")}</div>
      </div>
    `;
	}
	_renderSortGroup() {
		let e = this.working, t = e.sort.field === "updated_at" || e.sort.field === "created_at", n = t ? "Newest" : "Descending", r = t ? "Oldest" : "Ascending";
		return v`
      <div class="group">
        <span class="hv-label">Sort</span>
        <div class="chips">
          <label class="field select-field" data-testid="filter-sort-field">
            <span class="hv-sr-only">Sort by</span>
            <select
              @change=${(t) => this._patch({ sort: {
			field: t.target.value,
			order: e.sort.order
		} })}
            >
              ${An.map((t) => v`<option value=${t.field} ?selected=${e.sort.field === t.field}>${t.label}</option>`)}
            </select>
            <span class="chevron">${j("chevronDown", 14)}</span>
          </label>
          <span class="segmented" role="radiogroup" aria-label="Sort direction">
            ${["desc", "asc"].map((t) => v`<button
                class=${e.sort.order === t ? "on" : ""}
                role="radio"
                aria-checked=${String(e.sort.order === t)}
                data-testid="filter-sort-order"
                data-order=${t}
                @click=${() => this._patch({ sort: {
			field: e.sort.field,
			order: t
		} })}
              >
                ${t === "desc" ? n : r}
              </button>`)}
          </span>
          ${this._renderCheckbox("Low stock first", e.lowStockFirst, () => this._patch({ lowStockFirst: !e.lowStockFirst }), { testid: "filter-low-stock-first" })}
        </div>
        <span class="hint">Undated items always sort last, in both directions</span>
      </div>
    `;
	}
	render() {
		if (!this.filters) return null;
		let e = S(this.working);
		return v`
      <div class="panel" data-testid="filter-panel">
        ${this._renderLocationGroup()} ${this._renderCategoryGroup()} ${this._renderTagGroup()}
        ${this._renderShowOnlyGroup()} ${this._renderDateGroup()} ${this._renderSortGroup()}
        ${this.mobile ? null : v`<div class="footer">
              <span data-testid="filter-summary">
                ${P(e, "filter")} active${this.total !== null && this.grandTotal !== null ? ` · ${this.total} of ${this.grandTotal} match` : ""}
              </span>
              <button class="link" data-testid="filter-clear-all" @click=${() => this.clearAll()}>
                Clear all
              </button>
            </div>`}
      </div>
    `;
	}
}, kn.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .panel {
        padding: 14px;
        background: var(--hv-surface-raised);
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-panel);
        display: grid;
        gap: 13px;
      }
      :host([mobile]) .panel {
        background: transparent;
        border: none;
        border-radius: 0;
        padding: 14px 16px;
        gap: 16px;
      }
      .group {
        display: grid;
        gap: 7px;
      }
      .group-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        align-items: center;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: 1px solid var(--hv-divider);
        background: transparent;
        color: var(--hv-chip-text);
        border-radius: var(--hv-radius-chip);
        padding: 5px 12px;
        font: 400 12.5px var(--hv-font);
      }
      :host([mobile]) .chip {
        min-height: var(--hv-tap-min, 36px);
        padding: 0 14px;
        font-size: 13.5px;
      }
      .chip.on {
        color: var(--hv-primary-darker);
        background: var(--hv-primary-tint);
        border-color: var(--hv-primary);
      }
      .chip.on.warning {
        color: var(--hv-warn);
        background: var(--hv-warn-bg);
        border-color: var(--hv-amber);
      }
      .chip.more {
        border-style: dashed;
        color: var(--hv-text-secondary);
      }
      .chip .tally {
        opacity: 0.65;
      }
      .hint {
        font-size: 11px;
        color: var(--hv-text-tertiary);
      }
      .field {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        box-sizing: border-box;
        background: var(--hv-input-bg);
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        color: var(--hv-text);
        padding: 7px 11px;
        font: 400 12.5px var(--hv-font);
      }
      /*
       * 13.5px is the chip beside it — the area select sits in the same row as
       * "Any location", and taking the card's 16px input size made the one
       * full-width control on the page shout at the chips, checkboxes and
       * headings around it. Desktop matches at 12.5px.
       */
      :host([mobile]) .field {
        min-height: 46px;
        width: 100%;
        font-size: 13.5px;
      }
      /* Except a box you type free text into: 16px is what stops iOS zooming
         the page when it takes focus, and a select or a date field opens
         native UI instead of a keyboard. */
      :host([mobile]) .field input[type='search'] {
        font-size: var(--hv-input-font, 16px);
      }
      .field.on {
        border-color: var(--hv-primary);
      }
      .field.muted {
        color: var(--hv-text-tertiary);
      }
      /* The field draws its own chevron, so drop the browser's. */
      .field select {
        appearance: none;
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        color: inherit;
        font: inherit;
      }
      .field input[type='date'] {
        background: none;
        border: none;
        padding: 0;
        color: inherit;
        font: inherit;
      }
      /*
       * The comparison is a button, not a caption: it says which field this row
       * is about *and* which way the comparison runs, and clicking it flips the
       * direction.
       *
       * It carries its own outline and fill against the field's, which is the
       * smallest treatment that reads as a control at rest — a hover-only
       * affordance never arrives on a touch screen at all.
       */
      .field .direction {
        white-space: nowrap;
        box-sizing: border-box;
        border: 1px solid var(--hv-input-border);
        background: var(--hv-surface);
        border-radius: 6px;
        padding: 2px 7px;
        margin: -2px 0 -2px -4px;
        font: inherit;
        color: var(--hv-text-secondary);
        /* It sits inline in the field's label, so it takes height from the
           field it is in rather than becoming a block of its own. */
        display: inline-flex;
        align-items: center;
        min-height: var(--hv-tap-min, auto);
      }
      .field.on .direction {
        color: var(--hv-text);
        border-color: var(--hv-primary-tint-border);
      }
      .field .direction:hover {
        background: var(--hv-hover-overlay);
        border-color: var(--hv-primary);
        color: var(--hv-primary-dark);
      }
      /*
       * An appearance:none select is only as wide as its text, so the drawn
       * chevron sat outside it and clicking the chevron did nothing. The select
       * now fills the field and the chevron is decoration on top of it.
       */
      .field.select-field {
        position: relative;
        padding-right: 27px;
      }
      .field.select-field select {
        flex: 1;
        min-width: 0;
        /* The wrapper looked like a 46px control while the select inside it,
           which is what actually takes the tap, was 19px tall. */
        min-height: var(--hv-tap-min, auto);
      }
      .field .chevron {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        display: inline-flex;
        color: var(--hv-text-secondary);
        pointer-events: none;
      }
      .segmented {
        display: inline-flex;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-chip);
        overflow: hidden;
      }
      .segmented button {
        border: none;
        background: none;
        color: var(--hv-chip-text);
        padding: 4px 12px;
        font: 400 11.5px var(--hv-font);
        /* The pill around them looked like a control; each segment inside was
           22px tall. */
        min-height: var(--hv-tap-min, auto);
      }
      .segmented button.on {
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        font-weight: 500;
      }
      .check {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12.5px;
        color: var(--hv-chip-text);
        border: none;
        background: none;
        padding: 4px 0;
      }
      :host([mobile]) .check {
        min-height: var(--hv-tap-min, 44px);
        width: 100%;
        font-size: 14px;
      }
      .box {
        display: inline-grid;
        place-items: center;
        width: 15px;
        height: 15px;
        border-radius: 4px;
        border: 1.5px solid var(--hv-text-tertiary);
        color: #fff;
        flex: none;
      }
      :host([mobile]) .box {
        width: 20px;
        height: 20px;
        border-radius: 5px;
      }
      .box.on {
        background: var(--hv-primary);
        border-color: var(--hv-primary);
      }
      .box.on.warning {
        background: var(--hv-amber);
        border-color: var(--hv-amber);
      }
      .tally-right {
        margin-left: auto;
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
      }
      select {
        font: inherit;
        color: inherit;
        background: transparent;
        border: none;
        outline: none;
      }
      input[type='date'],
      input[type='search'] {
        font: inherit;
        color: inherit;
        background: transparent;
        border: none;
        outline: none;
        min-width: 0;
        /* Same trap as the select: a 46px field wrapping a 21px input. */
        min-height: var(--hv-tap-min, auto);
        flex: 1;
      }
      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-top: 1px solid var(--hv-divider);
        padding-top: 10px;
        font-size: 12px;
        color: var(--hv-text-secondary);
      }
      .link {
        border: none;
        background: none;
        font: 500 12.5px var(--hv-font);
        color: var(--hv-primary-dark);
        padding: 0;
      }
      .tree-holder {
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        background: var(--hv-surface);
        max-height: 230px;
        overflow: auto;
        padding: 4px 0;
      }
    `
], kn);
N([E({ attribute: !1 })], V.prototype, "filters", void 0), N([E({ attribute: !1 })], V.prototype, "distinct", void 0), N([E({ attribute: !1 })], V.prototype, "areas", void 0), N([E({ attribute: !1 })], V.prototype, "locations", void 0), N([E({ attribute: !1 })], V.prototype, "locationTree", void 0), N([E({ type: Number })], V.prototype, "total", void 0), N([E({ type: Number })], V.prototype, "grandTotal", void 0), N([E({
	type: Boolean,
	reflect: !0
})], V.prototype, "mobile", void 0), N([E({ attribute: !1 })], V.prototype, "counts", void 0), N([D()], V.prototype, "_draft", void 0), N([D()], V.prototype, "_locationOpen", void 0), N([D()], V.prototype, "_showAllCategories", void 0), N([D()], V.prototype, "_tagDraft", void 0), N([D()], V.prototype, "_dateDirection", void 0), V = N([T("hv-filter-panel")], V);
//#endregion
//#region node_modules/lit-html/directive.js
var Nn = {
	ATTRIBUTE: 1,
	CHILD: 2,
	PROPERTY: 3,
	BOOLEAN_ATTRIBUTE: 4,
	EVENT: 5,
	ELEMENT: 6
}, Pn = (e) => (...t) => ({
	_$litDirective$: e,
	values: t
}), Fn = class {
	constructor(e) {}
	get _$AU() {
		return this._$AM._$AU;
	}
	_$AT(e, t, n) {
		this._$Ct = e, this._$AM = t, this._$Ci = n;
	}
	_$AS(e, t) {
		return this.update(e, t);
	}
	update(e, t) {
		return this.render(...t);
	}
}, { I: In } = We, Ln = (e) => e, Rn = () => document.createComment(""), zn = (e, t, n) => {
	let r = e._$AA.parentNode, i = t === void 0 ? e._$AB : t._$AA;
	if (n === void 0) n = new In(r.insertBefore(Rn(), i), r.insertBefore(Rn(), i), e, e.options);
	else {
		let t = n._$AB.nextSibling, a = n._$AM, o = a !== e;
		if (o) {
			let t;
			n._$AQ?.(e), n._$AM = e, n._$AP !== void 0 && (t = e._$AU) !== a._$AU && n._$AP(t);
		}
		if (t !== i || o) {
			let e = n._$AA;
			for (; e !== t;) {
				let t = Ln(e).nextSibling;
				Ln(r).insertBefore(e, i), e = t;
			}
		}
	}
	return n;
}, H = (e, t, n = e) => (e._$AI(t, n), e), Bn = {}, Vn = (e, t = Bn) => e._$AH = t, Hn = (e) => e._$AH, Un = (e) => {
	e._$AR(), e._$AA.remove();
}, Wn = (e, t, n) => {
	let r = /* @__PURE__ */ new Map();
	for (let i = t; i <= n; i++) r.set(e[i], i);
	return r;
}, Gn = Pn(class extends Fn {
	constructor(e) {
		if (super(e), e.type !== Nn.CHILD) throw Error("repeat() can only be used in text expressions");
	}
	dt(e, t, n) {
		let r;
		n === void 0 ? n = t : t !== void 0 && (r = t);
		let i = [], a = [], o = 0;
		for (let t of e) i[o] = r ? r(t, o) : o, a[o] = n(t, o), o++;
		return {
			values: a,
			keys: i
		};
	}
	render(e, t, n) {
		return this.dt(e, t, n).values;
	}
	update(e, [t, n, r]) {
		let i = Hn(e), { values: a, keys: o } = this.dt(t, n, r);
		if (!Array.isArray(i)) return this.ut = o, a;
		let s = this.ut ?? (this.ut = []), c = [], l, u, d = 0, f = i.length - 1, p = 0, m = a.length - 1;
		for (; d <= f && p <= m;) if (i[d] === null) d++;
		else if (i[f] === null) f--;
		else if (s[d] === o[p]) c[p] = H(i[d], a[p]), d++, p++;
		else if (s[f] === o[m]) c[m] = H(i[f], a[m]), f--, m--;
		else if (s[d] === o[m]) c[m] = H(i[d], a[m]), zn(e, c[m + 1], i[d]), d++, m--;
		else if (s[f] === o[p]) c[p] = H(i[f], a[p]), zn(e, i[d], i[f]), f--, p++;
		else if (l === void 0 && (l = Wn(o, p, m), u = Wn(s, d, f)), l.has(s[d])) if (l.has(s[f])) {
			let t = u.get(o[p]), n = t === void 0 ? null : i[t];
			if (n === null) {
				let t = zn(e, i[d]);
				H(t, a[p]), c[p] = t;
			} else c[p] = H(n, a[p]), zn(e, i[d], n), i[t] = null;
			p++;
		} else Un(i[f]), f--;
		else Un(i[d]), d++;
		for (; p <= m;) {
			let t = zn(e, c[m + 1]);
			H(t, a[p]), c[p++] = t;
		}
		for (; d <= f;) {
			let e = i[d++];
			e !== null && Un(e);
		}
		return this.ut = o, Vn(e, c), Ae;
	}
}), Kn;
function qn(e) {
	return "id" in e;
}
var U = (Kn = class extends b {
	constructor(...e) {
		super(...e), this.entries = [], this.label = "More actions", this.onPrimary = !1, this._open = !1, this._zBase = 0, this._dialogFocus = new Zt(), this._onDocPointerDown = (e) => {
			e.composedPath().includes(this) || this.close();
		}, this._toggle = () => {
			if (this._open) {
				this.close();
				return;
			}
			this._zBase = M(), this._open = !0, document.addEventListener("pointerdown", this._onDocPointerDown, !0);
		};
	}
	updated() {
		this._dialogFocus.sync(this._open, () => this.renderRoot.querySelector("[data-testid=\"overflow-menu\"]"));
	}
	disconnectedCallback() {
		super.disconnectedCallback(), document.removeEventListener("pointerdown", this._onDocPointerDown, !0);
	}
	close() {
		this._open && (this._open = !1, document.removeEventListener("pointerdown", this._onDocPointerDown, !0));
	}
	_choose(e) {
		e.disabled || (this.close(), this.dispatchEvent(new CustomEvent("select", {
			detail: { id: e.id },
			bubbles: !0,
			composed: !0
		})));
	}
	render() {
		let e = this._zBase || 1e4;
		return v`
      <button
        class="hv-icon-button trigger ${this.onPrimary ? "on-primary" : ""}"
        data-testid="overflow-trigger"
        aria-haspopup="menu"
        aria-expanded=${String(this._open)}
        aria-label=${this.label}
        title=${this.label}
        @click=${this._toggle}
      >
        ${j("dotsVertical", 20)}
      </button>
      ${this._open ? v`<div class="scrim" role="presentation" data-testid="overflow-scrim" style="z-index: ${e};"></div>
          <div
            class="menu"
            role="menu"
            data-testid="overflow-menu"
            style="z-index: ${e + 1};"
            @keydown=${A(() => this.close())}
          >
            ${this.entries.map((e) => "divider" in e ? v`<div class="divider" role="separator"></div>` : "caption" in e ? v`<div class="caption">${e.caption}</div>` : qn(e) ? v`<button
                class="entry"
                role="menuitem"
                data-testid="overflow-item"
                data-id=${e.id}
                ?disabled=${e.disabled}
                @click=${() => this._choose(e)}
              >
                ${e.glyph ? v`<span class="glyph">${j(e.glyph, 18)}</span>` : null}
                <span class="labels">
                  ${e.label}${e.sub ? v`<span class="sub">${e.sub}</span>` : null}${e.meta ? v`<span class="meta">${e.meta}</span>` : null}
                </span>
                ${e.badge ? v`<span class="badge">${e.badge}</span>` : null}
              </button>` : null)}
          </div>` : null}
    `;
	}
}, Kn.styles = [
	O,
	k,
	o`
      :host {
        display: inline-block;
        position: relative;
      }
      .trigger.on-primary {
        color: #fff;
      }
      .trigger.on-primary:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .trigger[aria-expanded='true'] {
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
      }
      .menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        width: 250px;
        max-width: 80vw;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: 10px;
        box-shadow: var(--hv-shadow-menu);
        overflow: hidden;
        padding: 6px 0;
      }
      .entry {
        display: flex;
        align-items: center;
        gap: 11px;
        width: 100%;
        box-sizing: border-box;
        padding: 10px 14px;
        border: none;
        background: none;
        text-align: left;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
      }
      .entry:hover:not([disabled]) {
        background: var(--hv-hover-overlay);
      }
      .entry[disabled] {
        opacity: 0.45;
        cursor: default;
      }
      .entry .glyph {
        color: var(--hv-text-secondary);
        flex: none;
        display: inline-flex;
      }
      .labels {
        flex: 1;
        min-width: 0;
        /* A label with no break opportunity ("Organize…") would otherwise spill
           out of its shrunken box and paint over whatever sits beside it. */
        overflow-wrap: anywhere;
      }
      .sub,
      .meta {
        display: block;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
        margin-top: 1px;
      }
      .badge {
        flex: none;
        font: 500 11px var(--hv-font);
        color: var(--hv-warn);
        background: var(--hv-warn-bg);
        border-radius: var(--hv-radius-chip);
        padding: 2px 8px;
      }
      .divider {
        height: 1px;
        background: var(--hv-row-divider);
        margin: 5px 0;
      }
      .caption {
        padding: 6px 14px 3px;
        font-size: 10.5px;
        font-weight: 500;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: var(--hv-text-tertiary);
      }

      /* An anchored 250px dropdown is a desktop shape. At 375px it covered most
         of the list it was supposed to be acting on and "Export current view"
         wrapped onto two lines, while the rest of the card answers exactly this
         need with a bottom sheet. The menu becomes one here.

         A media query rather than the card's mobile flag: once the panel is
         position: fixed it is placed against the viewport, so the viewport is
         what decides whether there is room — and it keeps the component free
         of a mobile property that all three of its callers would have to
         thread through. */
      /* The dropdown form needs no scrim; only the sheet dims the page. */
      .scrim {
        display: none;
      }
      @media (max-width: 600px) {
        .menu {
          position: fixed;
          inset: auto 0 0 0;
          width: auto;
          max-width: none;
          border-radius: var(--hv-radius-sheet) var(--hv-radius-sheet) 0 0;
          box-shadow: var(--hv-shadow-sheet);
          padding: 8px 0 max(8px, env(safe-area-inset-bottom));
          animation: rise var(--hv-motion-sheet) var(--hv-ease-out);
        }
        /*
         * Dims the page behind the sheet.
         *
         * This was a ::before on the menu, which put the wash on top of the
         * menu's own background rather than behind it: the menu carries a
         * z-index, so it establishes a stacking context, and inside one the
         * element's background paints first and negative-z-index children
         * paint next — above that background, below the content. The white
         * sheet came out washed 50% black under fully opaque text, which read
         * as a menu with no surface of its own. A sibling with its own z-index
         * paints where a backdrop belongs.
         *
         * pointer-events: none is load-bearing: the menu closes on any outside
         * pointerdown, and that check asks whether the event's composed path
         * includes this element — a scrim that swallowed the tap would be
         * inside the path and would stop the menu closing when you tapped away
         * from it.
         */
        .scrim {
          display: block;
          position: fixed;
          inset: 0;
          background: var(--hv-scrim);
          pointer-events: none;
        }
        .entry {
          min-height: 48px;
          padding: 10px 18px;
          font-size: 15px;
        }
        .caption {
          padding: 8px 18px 4px;
        }
      }
      @keyframes rise {
        from {
          transform: translateY(16px);
          opacity: 0;
        }
        to {
          transform: none;
          opacity: 1;
        }
      }
    `
], Kn);
N([E({ attribute: !1 })], U.prototype, "entries", void 0), N([E({ type: String })], U.prototype, "label", void 0), N([E({ type: Boolean })], U.prototype, "onPrimary", void 0), N([D()], U.prototype, "_open", void 0), N([D()], U.prototype, "_zBase", void 0), U = N([T("hv-overflow-menu")], U);
//#endregion
//#region src/components/hv-list-row.ts
var Jn;
function Yn(e) {
	return typeof e.low_stock_threshold == "number" && e.quantity <= e.low_stock_threshold;
}
function Xn(e) {
	return fn(e.location_path?.display_path ?? "");
}
function Zn(e, t = 2) {
	let n = e.split(" › ");
	return n.length <= t ? e : `${n[0]} › … › ${n[n.length - 1]}`;
}
var Qn = (Jn = class extends b {
	constructor(...e) {
		super(...e), this.mobile = !1, this.selectable = !1, this.selected = !1, this.pending = !1, this._onKeydown = (e) => {
			switch (e.key) {
				case "Enter":
					e.preventDefault(), this._emit("open-item");
					break;
				case "Delete":
					e.preventDefault(), this._emit("request-delete");
					break;
				case "+":
				case "=":
				case "Add":
					e.preventDefault(), this._emit("increment");
					break;
				case "-":
				case "Subtract":
					e.preventDefault(), this._emit("decrement");
					break;
			}
		};
	}
	_emit(e, t = {}) {
		this.dispatchEvent(new CustomEvent(e, {
			detail: {
				itemId: this.item.id,
				...t
			},
			bubbles: !0,
			composed: !0
		}));
	}
	_menuEntries(e) {
		return e.checked_out ? [
			{
				id: "check-in",
				label: "Check in",
				glyph: "account"
			},
			{
				id: "set-due-date",
				label: e.due_date ? "Change due date…" : "Set due date…",
				glyph: "calendar"
			},
			{ divider: !0 },
			{
				id: "delete",
				label: "Delete item",
				glyph: "del"
			}
		] : [
			{
				id: "check-out",
				label: "Check out…",
				glyph: "account"
			},
			{
				id: "edit",
				label: "Edit",
				glyph: "pencil"
			},
			{ divider: !0 },
			{
				id: "delete",
				label: "Delete item",
				glyph: "del"
			}
		];
	}
	_renderStepper() {
		let e = this.item, t = Yn(e), n = e.checked_out;
		return this.mobile && e.checked_out ? v`<button
        class="check-in"
        data-testid="row-check-in"
        @click=${(e) => {
			e.stopPropagation(), this._emit("check-in");
		}}
      >
        Check in
      </button>` : v`
      <span class="stepper ${n ? "disabled" : ""}" data-testid="row-stepper">
        <button
          data-testid="row-decrement"
          aria-label="Decrease quantity"
          ?disabled=${n}
          @click=${(e) => {
			e.stopPropagation(), this._emit("decrement");
		}}
        >
          ${j("minus", 16)}
        </button>
        <span class="qty ${t ? "low" : ""}" data-testid="row-qty">${e.quantity}</span>
        <button
          data-testid="row-increment"
          aria-label="Increase quantity"
          ?disabled=${n}
          @click=${(e) => {
			e.stopPropagation(), this._emit("increment");
		}}
        >
          ${j("plus", 16)}
        </button>
      </span>
    `;
	}
	render() {
		let e = this.item;
		if (!e) return null;
		let t = Yn(e), n = R(e.due_date), r = R(e.inspection_date), i = Xn(e), a = [this.mobile ? Zn(i) : i, e.category].filter(Boolean).join(" · "), o = [i, e.category].filter(Boolean).join(" · "), s = e.checked_out ? "out" : r ? "inspect" : "";
		return v`
      <div
        class="row ${this.mobile ? "touch" : ""} ${this.selected ? "selected" : ""}"
        role="row"
        tabindex="0"
        aria-label=${`Item ${e.name}`}
        data-testid="list-row"
        data-item-id=${e.id}
        @keydown=${this._onKeydown}
        @click=${() => {
			this.selectable ? this._emit("toggle-select") : this._emit("open-item");
		}}
      >
        ${this.selectable ? v`<button
              class="box ${this.selected ? "on" : ""}"
              role="checkbox"
              aria-checked=${String(this.selected)}
              aria-label=${`Select ${e.name}`}
              data-testid="row-select"
              @click=${(e) => {
			e.stopPropagation(), this._emit("toggle-select");
		}}
            >
              ${this.selected ? j("check", 13) : null}
            </button>` : null}
        <span class="names">
          <span class="name" data-testid="row-name" title=${e.name}>${e.name}</span>
          <span
            class="secondary ${this.mobile ? s : ""} ${n && this.mobile ? "overdue" : ""}"
            data-testid="row-secondary"
            title=${o}
          >
            ${this.mobile && t && !e.checked_out ? v`<span class="dot" data-testid="row-low-dot"></span>` : null}
            ${this.mobile && e.checked_out ? v`${n ? "Overdue" : "Checked out"}${e.due_date ? ` · due ${L(e.due_date)}` : ""}` : this.mobile && r ? v`<span data-testid="row-inspection-due">Inspection due</span> · ${L(e.inspection_date)}` : a || "No location"}
          </span>
        </span>
        ${this.pending ? v`<span class="pending" data-testid="row-pending">pending</span>` : null}
        ${!this.mobile && t ? v`<span class="low-badge" data-testid="row-low" aria-label="Low stock">LOW</span>` : null}
        ${!this.mobile && e.checked_out ? v`<span class="out-chip ${n ? "overdue" : ""}" data-testid="row-checked-out">
              ${n ? `Overdue · ${L(e.due_date)}` : "Checked out"}
            </span>` : null}
        ${!this.mobile && r ? v`<span class="inspect-chip" data-testid="row-inspection-due">
              Inspection due
            </span>` : null}
        ${this.selectable ? null : v`<span class="hover-actions">
              <button
                data-testid="row-edit"
                aria-label=${`Edit ${e.name}`}
                title="Edit item"
                @click=${(e) => {
			e.stopPropagation(), this._emit("edit");
		}}
              >
                ${j("pencil", 18)}
              </button>
              <hv-overflow-menu
                data-testid="row-menu"
                label=${`Actions for ${e.name}`}
                .entries=${this._menuEntries(e)}
                @click=${(e) => e.stopPropagation()}
                @select=${(e) => {
			e.stopPropagation();
			let { id: t } = e.detail, n = (this.shadowRoot?.querySelector("[data-testid=\"row-menu\"]"))?.getBoundingClientRect();
			this._emit("row-action", {
				action: t,
				anchor: n
			});
		}}
              ></hv-overflow-menu>
            </span>`}
        ${this._renderStepper()}
      </div>
    `;
	}
}, Jn.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 44px;
        padding: 9px 16px;
        box-sizing: border-box;
        border-top: 1px solid var(--hv-row-divider);
        background: none;
        width: 100%;
        text-align: left;
        color: inherit;
        font: inherit;
      }
      :host([mobile]) .row {
        padding: 11px 14px;
      }
      :host(:first-of-type) .row {
        border-top: none;
      }
      .row:hover:not(.touch) {
        background: var(--hv-row-hover);
      }
      .row.selected {
        background: var(--hv-row-hover);
      }
      .names {
        flex: 1;
        min-width: 0;
      }
      /* Both lines must be block containers with inline content, or the
         ellipsis is silently ignored: overflow does not apply to an inline box,
         and text-overflow does not apply to a flex container. As spans inside a
         blockified flex item these were the first case, and .secondary was
         explicitly the second — so a long path hard-cut mid-character with no
         "…" to say anything had been dropped. */
      .name {
        display: block;
        font-size: 14px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      :host([mobile]) .name {
        font-size: 14.5px;
      }
      .secondary {
        display: block;
        font-size: 12px;
        color: var(--hv-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .secondary.out {
        color: var(--hv-primary-dark);
      }
      /* A passed due date is the one thing on this line worth interrupting for,
         and "due Jul 2" in the same blue as "due Aug 24" said nothing. */
      .secondary.overdue {
        color: var(--hv-error);
        font-weight: 500;
      }
      /* Amber, not that red: red here means an item is out and late back, while
         an inspection that has come due is a chore on something on the shelf. */
      .secondary.inspect {
        color: var(--hv-warn-deep);
        font-weight: 500;
      }
      .dot {
        display: inline-block;
        vertical-align: middle;
        margin-right: 6px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--hv-amber);
      }
      .low-badge {
        flex: none;
        font: 700 10.5px var(--hv-font);
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--hv-warn);
        background: var(--hv-warn-bg);
        border-radius: 4px;
        padding: 2px 6px;
      }
      .out-chip {
        flex: none;
        font: 500 11px var(--hv-font);
        color: var(--hv-primary-darker);
        border: 1px solid var(--hv-primary-tint-border);
        border-radius: var(--hv-radius-chip);
        padding: 2px 8px;
      }
      .out-chip.overdue {
        color: #fff;
        background: var(--hv-error);
        border-color: var(--hv-error);
      }
      /* Amber, not the out-chip's red: red on this card is reserved for an item
         that is out and late back, while an inspection that has come due is a
         chore on something still on the shelf. */
      .inspect-chip {
        flex: none;
        font: 500 11px var(--hv-font);
        color: var(--hv-warn-deep);
        background: var(--hv-warn-bg);
        border: 1px solid var(--hv-warn-border);
        border-radius: var(--hv-radius-chip);
        padding: 2px 8px;
        white-space: nowrap;
      }
      .hover-actions {
        flex: none;
        display: flex;
        gap: 2px;
        visibility: hidden;
      }
      .row:hover .hover-actions,
      .row:focus-within .hover-actions {
        visibility: visible;
      }
      :host([mobile]) .hover-actions {
        display: none;
      }
      .hover-actions button {
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--hv-text-secondary);
        padding: 0;
        transition: opacity var(--hv-motion-fast) ease-out;
      }
      .hover-actions button:hover {
        background: var(--hv-hover-overlay);
      }
      .stepper {
        flex: none;
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-chip);
      }
      .stepper.disabled {
        opacity: 0.45;
      }
      .stepper button {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: none;
        background: none;
        border-radius: 50%;
        color: var(--hv-text-secondary);
        padding: 0;
      }
      /* The most-tapped control in the app, and − sits directly beside + — a
         mis-tap here moves stock the wrong way, so these get real size rather
         than an invisible expanded hit area that would overlap its neighbour. */
      :host([mobile]) .stepper button {
        width: var(--hv-tap-min, 34px);
        height: var(--hv-tap-min, 34px);
      }
      .stepper button:hover:not([disabled]) {
        background: var(--hv-hover-overlay);
      }
      .qty {
        min-width: 26px;
        text-align: center;
        font: 500 13px var(--hv-font);
      }
      .qty.low {
        color: var(--hv-warn);
      }
      .check-in {
        flex: none;
        border: 1px solid var(--hv-primary-tint-border);
        background: none;
        color: var(--hv-primary-darker);
        border-radius: var(--hv-radius-chip);
        min-height: var(--hv-tap-min, 40px);
        padding: 0 18px;
        font: 500 13.5px var(--hv-font);
      }
      .pending {
        flex: none;
        font: 500 11px var(--hv-font);
        color: var(--hv-warn);
        background: var(--hv-warn-bg);
        border-radius: var(--hv-radius-chip);
        padding: 3px 8px;
      }
      .box {
        flex: none;
        display: inline-grid;
        place-items: center;
        width: 16px;
        height: 16px;
        border-radius: 3px;
        border: 1.5px solid var(--hv-text-tertiary);
        background: none;
        color: #fff;
        padding: 0;
      }
      .box.on {
        background: var(--hv-primary-dark);
        border-color: var(--hv-primary-dark);
      }
      /* A 16px box is far too small for a thumb. Tapping the row toggles the
         same selection, so an oversized hit area here can only ever agree with
         what is underneath it — no visual change needed. */
      :host([mobile]) .box {
        position: relative;
      }
      :host([mobile]) .box::after {
        content: '';
        position: absolute;
        inset: calc((var(--hv-tap-min, 16px) - 16px) / -2);
      }
    `
], Jn);
N([E({ attribute: !1 })], Qn.prototype, "item", void 0), N([E({
	type: Boolean,
	reflect: !0
})], Qn.prototype, "mobile", void 0), N([E({ type: Boolean })], Qn.prototype, "selectable", void 0), N([E({ type: Boolean })], Qn.prototype, "selected", void 0), N([E({ type: Boolean })], Qn.prototype, "pending", void 0), Qn = N([T("hv-list-row")], Qn);
//#endregion
//#region src/components/hv-list.ts
var $n, W = ($n = class extends b {
	constructor(...e) {
		super(...e), this.items = [], this.fill = !1, this.mobile = !1, this.loading = !1, this.selectable = !1, this.selection = /* @__PURE__ */ new Set(), this.pendingIds = /* @__PURE__ */ new Set(), this.emptyKind = "no-items", this.emptyLocationName = null, this.skeletonRows = 5, this.editorTemplate = null, this.editingItemId = null, this.addingNew = !1, this.editing = !1, this._onScroll = (e) => {
			let t = e.currentTarget, n = (t.scrollTop + t.clientHeight) / Math.max(1, t.scrollHeight);
			this.dispatchEvent(new CustomEvent("near-end", {
				detail: { ratio: n },
				bubbles: !0,
				composed: !0
			}));
		};
	}
	willUpdate(e) {
		(e.has("editingItemId") || e.has("addingNew") || e.has("editorTemplate")) && (this.editing = !!this.editorTemplate && (this.addingNew || this.editingItemId !== null));
	}
	_renderEmpty() {
		return on(this.emptyKind, {
			locationName: this.emptyLocationName,
			onAction: (e) => this.dispatchEvent(new CustomEvent("empty-action", {
				detail: { id: e },
				bubbles: !0,
				composed: !0
			}))
		});
	}
	render() {
		if (this.loading && !this.items.length) return v`<div class="scroller" data-testid="list-skeleton" aria-busy="true">
        ${Array.from({ length: this.skeletonRows }, () => v`<div class="skeleton-row">
            <div class="bar" style="width: 55%"></div>
            <div class="bar short" style="width: 38%"></div>
          </div>`)}
      </div>`;
		let e = this.addingNew && this.editorTemplate ? this.editorTemplate(null) : null;
		return !this.items.length && !e ? this._renderEmpty() : v`
      <div class="scroller" role="rowgroup" data-testid="list-rows" @scroll=${this._onScroll}>
        ${e}
        ${Gn(this.items, (e) => e.id, (e) => this.editingItemId === e.id && this.editorTemplate ? this.editorTemplate(e.id) : v`<hv-list-row
                  .item=${e}
                  ?mobile=${this.mobile}
                  ?selectable=${this.selectable}
                  ?selected=${this.selection.has(e.id)}
                  ?pending=${this.pendingIds.has(e.id)}
                ></hv-list-row>`)}
      </div>
    `;
	}
}, $n.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .scroller {
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      :host(:not([fill])) .scroller {
        max-height: var(--hv-list-max-height, 420px);
      }
      /*
       * The inline editor renders inside this same scroller and is roughly
       * 720px tall, so the compact cap buried its Save/Cancel row and the
       * custom-fields group. While an editor is open the card grows to fit the
       * form — as the design shows — but stays bounded so a long row list
       * cannot run away with the page.
       */
      :host(:not([fill])[editing]) .scroller {
        max-height: var(--hv-list-editing-max-height, min(80dvh, 760px));
      }
      :host([fill]) {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      :host([fill]) .scroller {
        flex: 1;
        min-height: 0;
      }
      .empty {
        display: grid;
        justify-items: center;
        gap: 10px;
        padding: 32px 16px;
        text-align: center;
        color: var(--hv-text-secondary);
        font-size: 13px;
      }
      .empty .headline {
        font-size: 14px;
        font-weight: 500;
        color: var(--hv-text);
      }
      .empty .offers {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
      }
      .skeleton-row {
        display: grid;
        gap: 6px;
        padding: 12px 16px;
        border-top: 1px solid var(--hv-row-divider);
      }
      .skeleton-row:first-child {
        border-top: none;
      }
      .bar {
        height: 10px;
        border-radius: 4px;
        background: var(--hv-row-divider);
      }
      .bar.short {
        height: 8px;
        opacity: 0.7;
      }
      @media (prefers-reduced-motion: no-preference) {
        .bar {
          animation: pulse 1.4s ease-in-out infinite;
        }
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }
    `
], $n);
N([E({ attribute: !1 })], W.prototype, "items", void 0), N([E({
	type: Boolean,
	reflect: !0
})], W.prototype, "fill", void 0), N([E({ type: Boolean })], W.prototype, "mobile", void 0), N([E({ type: Boolean })], W.prototype, "loading", void 0), N([E({ type: Boolean })], W.prototype, "selectable", void 0), N([E({ attribute: !1 })], W.prototype, "selection", void 0), N([E({ attribute: !1 })], W.prototype, "pendingIds", void 0), N([E({ type: String })], W.prototype, "emptyKind", void 0), N([E({ type: String })], W.prototype, "emptyLocationName", void 0), N([E({ type: Number })], W.prototype, "skeletonRows", void 0), N([E({ attribute: !1 })], W.prototype, "editorTemplate", void 0), N([E({ type: String })], W.prototype, "editingItemId", void 0), N([E({ type: Boolean })], W.prototype, "addingNew", void 0), N([E({
	type: Boolean,
	reflect: !0
})], W.prototype, "editing", void 0), W = N([T("hv-list")], W);
//#endregion
//#region src/ui/item-form.ts
var er = /^\d{4}-\d{2}-\d{2}$/, tr = 0;
function nr(e = {}) {
	return tr += 1, {
		id: tr,
		key: "",
		type: "string",
		value: "",
		...e
	};
}
function rr(e) {
	return typeof e == "boolean" ? "boolean" : typeof e == "number" ? "number" : typeof e == "string" && er.test(e) ? "date" : "string";
}
function ir(e) {
	return typeof e == "boolean" ? e ? "true" : "false" : String(e);
}
function ar(e) {
	return {
		name: e?.name ?? "",
		description: e?.description ?? "",
		quantity: e?.quantity ?? 1,
		lowStock: e?.low_stock_threshold ?? null,
		category: e?.category ?? "",
		tags: [...e?.tags ?? []],
		locationId: e?.location_id ?? null,
		checkedOut: !!e?.checked_out,
		dueDate: e?.due_date ?? "",
		inspectionDate: e?.inspection_date ?? "",
		customFields: Object.entries(e?.custom_fields ?? {}).map(([e, t]) => nr({
			key: e,
			type: rr(t),
			value: ir(t)
		}))
	};
}
function or(e) {
	let t = [];
	e.name.trim() ? e.name.trim().length > 120 && t.push({
		field: "name",
		message: "Name is limited to 120 characters."
	}) : t.push({
		field: "name",
		message: "Name is required."
	}), (!Number.isFinite(e.quantity) || !Number.isInteger(e.quantity) || e.quantity < 0) && t.push({
		field: "quantity",
		message: "Quantity can't be negative."
	}), e.lowStock !== null && (!Number.isFinite(e.lowStock) || e.lowStock < 0) && t.push({
		field: "lowStock",
		message: "Low-stock threshold must be 0 or more, or empty."
	});
	let n = /* @__PURE__ */ new Set();
	for (let r of e.customFields) {
		let e = r.key.trim();
		if (e) {
			if (n.has(e)) {
				t.push({
					field: `custom:${r.id}`,
					message: `"${e}" is used twice.`
				});
				continue;
			}
			n.add(e), r.type === "number" && (r.value.trim() === "" || !Number.isFinite(Number(r.value))) && t.push({
				field: `custom:${r.id}`,
				message: `"${e}" must be a number.`
			}), r.type === "date" && r.value.trim() !== "" && !er.test(r.value.trim()) && t.push({
				field: `custom:${r.id}`,
				message: `"${e}" must be a date.`
			});
		}
	}
	return t;
}
function sr(e) {
	let t = {};
	for (let n of e.customFields) {
		let e = n.key.trim();
		if (e) if (n.type === "number") {
			let r = Number(n.value);
			if (n.value.trim() === "" || !Number.isFinite(r)) continue;
			t[e] = r;
		} else if (n.type === "boolean") t[e] = n.value === "true";
		else {
			if (n.value.trim() === "") continue;
			t[e] = n.value;
		}
	}
	return t;
}
function cr(e) {
	let t = [];
	for (let n of e) {
		let e = n.trim().toLowerCase();
		e && !t.includes(e) && t.push(e);
	}
	return t;
}
function lr(e) {
	return {
		name: e.name.trim(),
		description: e.description.trim() || null,
		quantity: e.quantity,
		low_stock_threshold: e.lowStock,
		category: e.category.trim() || null,
		tags: cr(e.tags),
		location_id: e.locationId,
		checked_out: e.checkedOut,
		due_date: e.checkedOut && e.dueDate || null,
		inspection_date: e.inspectionDate || null
	};
}
function ur(e) {
	return {
		...lr(e),
		custom_fields: sr(e)
	};
}
function dr(e, t) {
	let n = sr(e), r = Object.keys(t.custom_fields ?? {}).filter((e) => !(e in n)), i = {
		...lr(e),
		custom_fields_set: n
	};
	return r.length && (i.custom_fields_unset = r), i;
}
function fr(e, t) {
	let n = ar(t);
	return e.name !== n.name || e.description !== n.description || e.quantity !== n.quantity || e.lowStock !== n.lowStock || e.category !== n.category || e.locationId !== n.locationId || e.checkedOut !== n.checkedOut || e.dueDate !== n.dueDate || e.inspectionDate !== n.inspectionDate || cr(e.tags).join(" ") !== cr(n.tags).join(" ") || JSON.stringify(sr(e)) !== JSON.stringify(sr(n));
}
//#endregion
//#region src/components/hv-chip-input.ts
var pr, mr = (pr = class extends b {
	constructor(...e) {
		super(...e), this.values = [], this.suggestions = [], this.placeholder = "Add tag…", this.maxSuggestions = 3, this._draft = "";
	}
	_emit(e) {
		this.dispatchEvent(new CustomEvent("change", {
			detail: { values: e },
			bubbles: !0,
			composed: !0
		}));
	}
	_add(e) {
		let t = cr([...this.values, e]);
		this._draft = "", (t.length !== this.values.length || t.join(" ") !== this.values.join(" ")) && this._emit(t);
	}
	_remove(e) {
		this._emit(this.values.filter((t) => t !== e));
	}
	get _visibleSuggestions() {
		let e = this._draft.trim().toLowerCase();
		return this.suggestions.filter((e) => !this.values.includes(e.toLowerCase())).filter((t) => !e || t.toLowerCase().includes(e)).slice(0, this.maxSuggestions);
	}
	render() {
		let e = this._visibleSuggestions;
		return v`
      <div class="field" data-testid="chip-field">
        ${this.values.map((e) => v`<span class="chip" data-testid="chip" data-value=${e}>
            ${e}
            <button
              class="hv-icon-button chip-remove"
              data-testid="chip-remove"
              data-value=${e}
              aria-label=${`Remove ${e}`}
              @click=${() => this._remove(e)}
            >
              ${j("close", 12)}
            </button>
          </span>`)}
        <input
          type="text"
          data-testid="chip-input"
          placeholder=${this.placeholder}
          .value=${this._draft}
          @input=${(e) => {
			this._draft = e.target.value;
		}}
          @keydown=${(e) => {
			e.key === "Enter" || e.key === "," ? (e.preventDefault(), this._add(this._draft)) : e.key === "Backspace" && !this._draft && this.values.length && (e.preventDefault(), this._remove(this.values[this.values.length - 1]));
		}}
          @blur=${() => this._add(this._draft)}
        />
      </div>
      ${e.length ? v`<div class="suggestions" data-testid="chip-suggestions">
            ${e.map((e) => v`<button
                class="suggestion"
                data-testid="chip-suggestion"
                data-value=${e}
                @mousedown=${(e) => e.preventDefault()}
                @click=${() => this._add(e)}
              >
                ${e}
              </button>`)}
          </div>` : null}
    `;
	}
}, pr.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .field {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        background: var(--hv-surface);
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        padding: 7px 11px;
      }
      .field:focus-within {
        border-color: var(--hv-primary);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        min-height: var(--hv-tap-min, auto);
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
        padding: 3px 9px;
        font: 400 12px var(--hv-font);
      }
      .chip svg {
        opacity: 0.75;
      }
      /* The one control that does not reach 44px. It is a 14px glyph living
         inside a chip that wraps with a 6px gap, so a 44px hit area would reach
         well into the chip beside it and remove the wrong tag. 24px is the
         widest it can grow while still belonging to its own chip, which meets
         WCAG 2.5.8 even though it misses the 2.5.5 target the rest of the
         mobile controls now hit. */
      .chip-remove {
        position: relative;
        width: 14px;
        height: 14px;
        color: inherit;
      }
      .chip-remove::after {
        content: '';
        position: absolute;
        inset: -5px;
      }
      input {
        flex: 1;
        min-width: 90px;
        min-height: var(--hv-tap-min, auto);
        border: none;
        outline: none;
        background: none;
        font: 400 var(--hv-input-font, 12.5px) var(--hv-font);
        color: var(--hv-text);
      }
      .suggestions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 5px;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      .suggestion {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: var(--hv-tap-min, auto);
        /* A three-letter tag is otherwise a 23px-wide target. */
        min-width: var(--hv-tap-min, auto);
        border: none;
        background: none;
        padding: 0 6px;
        font: inherit;
        color: var(--hv-primary-dark);
      }
    `
], pr);
N([E({ attribute: !1 })], mr.prototype, "values", void 0), N([E({ attribute: !1 })], mr.prototype, "suggestions", void 0), N([E({ type: String })], mr.prototype, "placeholder", void 0), N([E({ type: Number })], mr.prototype, "maxSuggestions", void 0), N([D()], mr.prototype, "_draft", void 0), mr = N([T("hv-chip-input")], mr);
//#endregion
//#region src/components/hv-checkout-popover.ts
var hr, gr = 7, G = (hr = class extends b {
	constructor(...e) {
		super(...e), this.item = null, this.open = !1, this.mobile = !1, this.anchor = null, this.mode = "check-out", this.itemName = "", this._due = null, this._zBase = 0, this._customOpen = !1, this._customDays = 14, this._dialogFocus = new Zt(), this._cancel = () => {
			this.open = !1, this.dispatchEvent(new CustomEvent("cancel", {
				bubbles: !0,
				composed: !0
			}));
		};
	}
	updated() {
		this._dialogFocus.sync(this.open, () => this.renderRoot.querySelector("[data-testid=\"checkout-popover\"]"));
	}
	willUpdate(e) {
		e.has("open") && this.open && (this._zBase = M(), this._due = this.item?.due_date || z(gr), this._customOpen = !1, this._customDays = 14);
	}
	_commit(e) {
		this.open = !1, this.dispatchEvent(new CustomEvent(this.mode === "set-due-date" ? "set-due-date" : "check-out", {
			detail: {
				itemId: this.item?.id,
				dueDate: e
			},
			bubbles: !0,
			composed: !0
		}));
	}
	get _position() {
		if (this.mobile || !this.anchor) return "top: 20dvh; left: 50%; transform: translateX(-50%);";
		let e = typeof window > "u" ? 300 : window.innerWidth, t = typeof window > "u" ? 800 : window.innerHeight, n = Math.max(8, Math.min(this.anchor.left, e - 300 - 8)), r = t - this.anchor.bottom - 6, i = this.anchor.top - 6;
		return r < 300 && i > r ? `bottom: ${Math.round(t - this.anchor.top + 6)}px; left: ${n}px;` : `top: ${Math.round(this.anchor.bottom + 6)}px; left: ${n}px;`;
	}
	render() {
		let e = this.item?.name || this.itemName;
		if (!this.open || !e) return null;
		let t = this._zBase || 9998, n = this.mode === "set-due-date", r = v`
      <div
        class="card"
        role="dialog"
        aria-modal="true"
        aria-label=${n ? "Set due date" : `Check out ${e}`}
        data-testid="checkout-popover"
        style=${this.mobile ? "" : `z-index:${t + 1}; ${this._position}`}
        @keydown=${A(() => this._cancel())}
      >
        <div class="head">
          <div class="title" data-testid="checkout-title">
            ${n ? "Set a due date" : `Check out ${e}`}
          </div>
          <div class="sub">A due date is optional — it's what makes overdue highlighting work.</div>
        </div>
        <div class="body">
          <div class="offsets">
            ${Cn.map((e) => {
			let t = z(e.days);
			return v`<button
                class="offset ${!this._customOpen && this._due === t ? "on" : ""}"
                data-testid="checkout-offset"
                data-days=${e.days}
                @click=${() => {
				this._customOpen = !1, this._due = t;
			}}
              >
                ${e.label}
              </button>`;
		})}
            <button
              class="offset ${this._customOpen ? "on" : ""}"
              data-testid="checkout-offset-custom"
              @click=${() => {
			this._customOpen = !0, this._due = z(this._customDays);
		}}
            >
              +X days
            </button>
          </div>
          ${this._customOpen ? v`<label class="custom" data-testid="checkout-custom">
                <input
                  type="number"
                  min="1"
                  max="3650"
                  inputmode="numeric"
                  aria-label="Days from today"
                  .value=${String(this._customDays)}
                  @input=${(e) => {
			let t = Number(e.target.value);
			this._customDays = t, this._due = Number.isFinite(t) && t >= 1 ? z(Math.floor(t)) : null;
		}}
                />
                <span>days from today</span>
              </label>` : null}
          <label class="date ${this._due ? "" : "none"}" data-testid="checkout-date">
            ${j("calendar", 17)}
            <span class="hv-sr-only">Due date</span>
            <input
              type="date"
              .value=${this._due ?? ""}
              @input=${(e) => {
			this._due = e.target.value || null;
		}}
            />
            <span data-testid="checkout-date-label">${this._due ? L(this._due) : "No due date"}</span>
          </label>
        </div>
        <div class="actions">
          <button
            class="hv-text-button none-button"
            data-testid="checkout-no-date"
            @click=${() => this._commit(null)}
          >
            ${n ? "Clear due date" : "Check out with no due date"}
          </button>
          ${this.mobile ? null : v`<span class="spacer"></span>`}
          <button class="hv-text-button" data-testid="checkout-cancel" @click=${this._cancel}>Cancel</button>
          <button
            class="confirm"
            data-testid="checkout-confirm"
            ?disabled=${!this._due}
            @click=${() => this._commit(this._due)}
          >
            ${n ? "Set" : "Check out"}${this._due ? ` · due ${L(this._due)}` : ""}
          </button>
        </div>
      </div>
    `;
		return this.mobile ? r : v`
      <div class="scrim" role="presentation" style="z-index:${t}" @click=${this._cancel}></div>
      ${r}
    `;
	}
}, hr.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .scrim {
        position: fixed;
        inset: 0;
      }
      .card {
        position: fixed;
        width: 300px;
        max-width: calc(100vw - 16px);
        box-sizing: border-box;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: var(--hv-radius-panel);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.24);
        overflow: hidden;
      }
      :host([mobile]) .card {
        position: static;
        width: auto;
        border: 1px solid var(--hv-primary);
        border-radius: var(--hv-radius-panel);
        box-shadow: none;
        background: var(--hv-surface-raised);
      }
      .head {
        padding: 14px 16px 10px;
      }
      .head .title {
        font: 500 15px var(--hv-font);
      }
      .head .sub {
        font-size: 12.5px;
        color: var(--hv-text-secondary);
        margin-top: 3px;
        line-height: 1.45;
      }
      .body {
        padding: 0 16px 12px;
        display: grid;
        gap: 8px;
      }
      .offsets {
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
      }
      .offset {
        border: 1px solid var(--hv-divider);
        background: none;
        color: var(--hv-chip-text);
        border-radius: var(--hv-radius-chip);
        padding: 6px 13px;
        font: 400 12.5px var(--hv-font);
      }
      :host([mobile]) .offset {
        min-height: 40px;
        padding: 0 15px;
        font-size: 13.5px;
      }
      .offset.on {
        background: var(--hv-primary-dark);
        border-color: var(--hv-primary-dark);
        color: #fff;
        font-weight: 500;
      }
      .custom {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        font-size: 13px;
        color: var(--hv-text-secondary);
      }
      .custom input {
        width: 72px;
        box-sizing: border-box;
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        background: var(--hv-surface);
        color: var(--hv-text);
        padding: 5px 8px;
        font: 400 13.5px var(--hv-font);
      }
      :host([mobile]) .custom input {
        min-height: 44px;
        width: 88px;
        font-size: var(--hv-input-font, 14.5px);
      }
      .date {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border: 1px solid var(--hv-primary);
        border-radius: var(--hv-radius-input);
        font-size: 13.5px;
      }
      :host([mobile]) .date {
        min-height: 48px;
        font-size: var(--hv-input-font, 13.5px);
      }
      .date input {
        flex: 1;
        min-width: 0;
        border: none;
        background: none;
        outline: none;
        font: inherit;
        color: inherit;
      }
      .date.none {
        border-color: var(--hv-divider);
        color: var(--hv-text-tertiary);
      }
      /* Three buttons never fit across 300px once the confirm label carries a
         date: every one of them wrapped onto three lines. The escape hatch
         takes a row of its own and the pair that ends the dialog keeps the
         bottom one. */
      .actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 12px 14px;
      }
      .actions .none-button {
        flex-basis: 100%;
      }
      :host(:not([mobile])) .actions .none-button {
        text-align: left;
      }
      :host([mobile]) .actions {
        display: grid;
        gap: 9px;
        padding: 0 12px 14px;
      }
      .actions .spacer {
        margin-left: auto;
      }
      .confirm {
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        padding: 8px 16px;
        font: 500 13px var(--hv-font);
      }
      :host([mobile]) .confirm {
        min-height: 50px;
        font-size: 15px;
      }
      :host([mobile]) .none-button {
        min-height: 48px;
        border: 1px solid var(--hv-input-border);
        background: none;
        color: var(--hv-chip-text);
        border-radius: var(--hv-radius-chip);
        font: 400 14px var(--hv-font);
      }
    `
], hr);
N([E({ attribute: !1 })], G.prototype, "item", void 0), N([E({
	type: Boolean,
	reflect: !0
})], G.prototype, "open", void 0), N([E({
	type: Boolean,
	reflect: !0
})], G.prototype, "mobile", void 0), N([E({ attribute: !1 })], G.prototype, "anchor", void 0), N([E({ type: String })], G.prototype, "mode", void 0), N([E({ type: String })], G.prototype, "itemName", void 0), N([D()], G.prototype, "_due", void 0), N([D()], G.prototype, "_zBase", void 0), N([D()], G.prototype, "_customOpen", void 0), N([D()], G.prototype, "_customDays", void 0), G = N([T("hv-checkout-popover")], G);
//#endregion
//#region src/components/hv-item-editor.ts
var _r, vr = "A due date applies while the item is checked out.", yr = [
	{
		value: "string",
		label: "Text"
	},
	{
		value: "number",
		label: "Number"
	},
	{
		value: "boolean",
		label: "Yes/No"
	},
	{
		value: "date",
		label: "Date"
	}
], K = (_r = class extends b {
	constructor(...e) {
		super(...e), this.item = null, this.locations = null, this.locationTree = [], this.categorySuggestions = [], this.tagSuggestions = [], this.customFieldKeys = [], this.mobile = !1, this.busy = !1, this.errorMessage = null, this.noHeader = !1, this._model = ar(null), this._errors = [], this._showErrors = !1, this._locationOpen = !1, this._moreOpen = !1, this._categoryOpen = !1, this._categoryShowAll = !1, this._categoryIndex = -1, this._categoryBox = null, this._categoryZ = 0, this._checkoutOpen = !1, this._checkoutAnchor = null, this._inspectionCustomOpen = !1, this._inspectionCustomDays = 14, this._save = () => {
			let e = or(this._model);
			if (this._errors = e, this._showErrors = !0, e.length) return;
			let t = this.item ? {
				itemId: this.item.id,
				expectedVersion: this.item.version,
				changes: dr(this._model, this.item)
			} : {
				itemId: null,
				expectedVersion: void 0,
				create: ur(this._model)
			};
			this.dispatchEvent(new CustomEvent("save", {
				detail: t,
				bubbles: !0,
				composed: !0
			}));
		}, this._cancel = () => {
			this.dispatchEvent(new CustomEvent("cancel", {
				bubbles: !0,
				composed: !0
			}));
		}, this._onKeydown = (e) => {
			e.key === "Escape" ? (e.preventDefault(), e.stopPropagation(), this._cancel()) : e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), this._save());
		}, this._placeCategory = () => {
			let e = this.renderRoot?.querySelector(".combo");
			if (!e) return;
			let t = e.getBoundingClientRect(), n = window.innerHeight, r = n - t.bottom - 6 - 8, i = t.top - 6 - 8, a = r < 120 && i > r;
			this._categoryBox = {
				left: Math.round(t.left),
				width: Math.round(t.width),
				edge: Math.round(a ? n - t.top + 6 : t.bottom + 6),
				flip: a,
				room: Math.max(80, Math.round(a ? i : r))
			};
		}, this._onCheckoutPressed = (e) => {
			if (this._model.checkedOut) {
				this._patch({ checkedOut: !1 });
				return;
			}
			this._checkoutAnchor = e.currentTarget.getBoundingClientRect(), this._checkoutOpen = !0;
		};
	}
	firstUpdated() {
		this.renderRoot.querySelector("[data-testid=\"editor-name\"]")?.focus();
	}
	willUpdate(e) {
		e.has("item") && (this._model = ar(this.item), this._errors = [], this._showErrors = !1, this._locationOpen = !1, this._moreOpen = !1, this._checkoutOpen = !1, this._closeCategory());
	}
	get dirty() {
		return fr(this._model, this.item);
	}
	_patch(e) {
		this._model = {
			...this._model,
			...e
		}, this._showErrors && (this._errors = or(this._model));
	}
	_errorFor(e) {
		return this._showErrors ? this._errors.find((t) => t.field === e)?.message ?? null : null;
	}
	_text(e, t, n = { testid: "" }) {
		let r = this._errorFor(e);
		return v`<div class="cell ${r ? "invalid" : ""}">
      <label class="hv-label" for=${n.testid}>${t}</label>
      <input
        id=${n.testid}
        class="hv-input"
        type=${n.type ?? "text"}
        data-testid=${n.testid}
        .value=${String(this._model[e] ?? "")}
        @input=${(t) => {
			let r = t.target.value;
			n.type === "number" ? this._patch({ [e]: r === "" ? null : Number(r) }) : this._patch({ [e]: r });
		}}
      />
      ${r ? v`<span class="field-error" data-testid=${`${n.testid}-error`}>${r}</span>` : null}
    </div>`;
	}
	_renderLocationField() {
		let e = pn((this.locations ?? []).find((e) => e.id === this._model.locationId), "No location");
		return v`<div class="cell span2">
      <span class="hv-label">Location</span>
      <button
        class="field-button ${this._model.locationId ? "" : "empty"}"
        data-testid="editor-location"
        aria-expanded=${String(this._locationOpen)}
        @click=${() => {
			this._locationOpen = !this._locationOpen;
		}}
      >
        ${j("mapMarker", 15)}<span class="value">${e}</span>${j("chevronDown", 15)}
      </button>
      ${this._locationOpen ? v`<div class="tree-holder">
            <hv-location-tree
              data-testid="editor-location-tree"
              .nodes=${this.locationTree}
              .selectedId=${this._model.locationId}
              showAll
              allLabel="No location"
              allIcon="close"
              @select=${(e) => {
			this._patch({ locationId: e.detail.locationId }), this._locationOpen = !1;
		}}
            ></hv-location-tree>
          </div>` : null}
    </div>`;
	}
	get _categoryOptions() {
		let e = this._model.category.trim().toLowerCase();
		return this._categoryShowAll || !e ? this.categorySuggestions : this.categorySuggestions.filter((t) => t.toLowerCase().includes(e));
	}
	get _categoryStyle() {
		let e = this._categoryBox;
		return e ? `${e.flip ? `bottom: ${e.edge}px` : `top: ${e.edge}px`}; left: ${e.left}px; width: ${e.width}px; max-height: min(220px, ${e.room}px); z-index: ${this._categoryZ || 9999};` : "";
	}
	_openCategory(e) {
		this.categorySuggestions.length && (this._categoryShowAll = e, this._categoryOpen || (this._categoryZ = M(), window.addEventListener("scroll", this._placeCategory, !0), window.addEventListener("resize", this._placeCategory)), this._categoryOpen = !0, this._categoryIndex = -1, this._placeCategory());
	}
	_closeCategory() {
		this._categoryOpen && (window.removeEventListener("scroll", this._placeCategory, !0), window.removeEventListener("resize", this._placeCategory)), this._categoryOpen = !1, this._categoryShowAll = !1, this._categoryIndex = -1, this._categoryBox = null;
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._closeCategory();
	}
	_chooseCategory(e) {
		this._patch({ category: e }), this._closeCategory();
	}
	_onCategoryKeydown(e) {
		let t = this._categoryOptions;
		switch (e.key) {
			case "ArrowDown":
			case "ArrowUp": {
				if (e.preventDefault(), !this._categoryOpen) {
					this._openCategory(!1), this._categoryIndex = 0;
					return;
				}
				if (!t.length) return;
				let n = e.key === "ArrowDown" ? 1 : -1;
				this._categoryIndex = (this._categoryIndex + n + t.length) % t.length;
				break;
			}
			case "Enter":
				this._categoryOpen && t[this._categoryIndex] && (e.preventDefault(), e.stopPropagation(), this._chooseCategory(t[this._categoryIndex]));
				break;
			case "Escape":
				this._categoryOpen && (e.preventDefault(), e.stopPropagation(), this._closeCategory());
				break;
			case "Tab":
				this._closeCategory();
				break;
		}
	}
	_renderCategoryField() {
		let e = this._model.category.trim(), t = this._categoryOptions;
		return v`<div class="cell">
      <label class="hv-label" for="editor-category">Category</label>
      <div class="combo">
        <input
          id="editor-category"
          class="hv-input"
          data-testid="editor-category"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          aria-expanded=${String(this._categoryOpen)}
          aria-controls="editor-category-list"
          aria-activedescendant=${this._categoryOpen && this._categoryIndex >= 0 ? `editor-category-option-${this._categoryIndex}` : ""}
          .value=${this._model.category}
          @focus=${() => this._openCategory(!0)}
          @input=${(e) => {
			this._patch({ category: e.target.value }), this._openCategory(!1);
		}}
          @keydown=${this._onCategoryKeydown}
          @blur=${() => this._closeCategory()}
        />
        ${this.categorySuggestions.length ? v`<button
              class="combo-arrow"
              data-testid="editor-category-toggle"
              tabindex="-1"
              aria-label="Show all categories"
              title="Show all categories"
              @mousedown=${(e) => e.preventDefault()}
              @click=${() => {
			this._categoryOpen && this._categoryShowAll ? this._closeCategory() : this._openCategory(!0);
		}}
            >
              ${j("chevronDown", 18)}
            </button>` : null}
      </div>
      ${this._categoryOpen ? v`<div
            class="list-holder floating"
            role="listbox"
            id="editor-category-list"
            data-testid="editor-category-list"
            style=${this._categoryStyle}
          >
            ${t.length ? t.map((t, n) => v`<button
                    class="option ${n === this._categoryIndex ? "active" : ""} ${t.toLowerCase() === e.toLowerCase() ? "selected" : ""}"
                    id=${`editor-category-option-${n}`}
                    role="option"
                    aria-selected=${String(t.toLowerCase() === e.toLowerCase())}
                    data-testid="editor-category-option"
                    data-value=${t}
                    @mousedown=${(e) => e.preventDefault()}
                    @click=${() => this._chooseCategory(t)}
                  >
                    <span class="label">${t}</span>
                    ${t.toLowerCase() === e.toLowerCase() ? j("check", 15) : null}
                  </button>`) : v`<div class="option-empty" data-testid="editor-category-empty">
                  No existing category matches “${e}” — saving adds it as a new one.
                </div>`}
          </div>` : null}
    </div>`;
	}
	_renderStateFields() {
		let e = this._model;
		return v`<div class="cell span3">
      <div class="state">
        <div class="group" role="group" aria-labelledby="editor-checkout-caption">
          <span class="group-caption" id="editor-checkout-caption" data-testid="editor-checkout-caption">
            ${j("account", 14)} Checkout
          </span>
          <div class="group-body checkout-body">
            <div class="cell">
              <button
                class="field-button checkout-action"
                data-testid="editor-checked-out"
                @click=${this._onCheckoutPressed}
              >
                ${j(e.checkedOut ? "check" : "account", 16)}
                <span>${e.checkedOut ? "Check in" : "Check out…"}</span>
              </button>
            </div>
            <div class="cell ${e.checkedOut ? "" : "muted"}">
              <label class="hv-label" for="editor-due">Due date</label>
              <input
                id="editor-due"
                class="hv-input"
                type="date"
                data-testid="editor-due-date"
                ?disabled=${!e.checkedOut}
                title=${e.checkedOut ? "" : vr}
                .value=${e.dueDate}
                @input=${(e) => this._patch({ dueDate: e.target.value })}
              />
            </div>
          </div>
          ${e.checkedOut ? null : v`<span class="group-hint" data-testid="editor-due-hint">${vr}</span>`}
          <hv-checkout-popover
            data-testid="editor-checkout"
            .item=${this.item}
            .itemName=${e.name.trim() || "this item"}
            .anchor=${this._checkoutAnchor}
            ?mobile=${this.mobile}
            ?open=${this._checkoutOpen}
            @check-out=${(e) => {
			e.stopPropagation();
			let { dueDate: t } = e.detail;
			this._patch({
				checkedOut: !0,
				dueDate: t ?? ""
			}), this._checkoutOpen = !1;
		}}
            @cancel=${(e) => {
			e.stopPropagation(), this._checkoutOpen = !1;
		}}
          ></hv-checkout-popover>
        </div>
        <div class="group">
          <label class="group-caption" for="editor-inspection" data-testid="editor-inspection-caption">
            ${j("calendar", 14)} Next inspection
          </label>
          <div class="group-body">
            <input
              id="editor-inspection"
              class="hv-input"
              type="date"
              data-testid="editor-inspection-date"
              .value=${e.inspectionDate}
              @input=${(e) => this._patch({ inspectionDate: e.target.value })}
            />
            ${this._renderInspectionOffsets(e.inspectionDate)}
          </div>
        </div>
      </div>
    </div>`;
	}
	_renderInspectionOffsets(e) {
		return v`
      <div class="offsets" data-testid="editor-inspection-offsets">
        ${Cn.map((t) => {
			let n = z(t.days);
			return v`<button
            class="offset ${!this._inspectionCustomOpen && e === n ? "on" : ""}"
            data-testid="editor-inspection-offset"
            data-days=${t.days}
            @click=${() => {
				this._inspectionCustomOpen = !1, this._patch({ inspectionDate: n });
			}}
          >
            ${t.label}
          </button>`;
		})}
        <button
          class="offset ${this._inspectionCustomOpen ? "on" : ""}"
          data-testid="editor-inspection-offset-custom"
          @click=${() => {
			this._inspectionCustomOpen = !0, this._patch({ inspectionDate: z(this._inspectionCustomDays) });
		}}
        >
          +X days
        </button>
      </div>
      ${this._inspectionCustomOpen ? v`<label class="custom-days" data-testid="editor-inspection-custom">
            <input
              type="number"
              min="1"
              max="3650"
              inputmode="numeric"
              aria-label="Days from today"
              .value=${String(this._inspectionCustomDays)}
              @input=${(e) => {
			let t = Number(e.target.value);
			this._inspectionCustomDays = t, this._patch({ inspectionDate: Number.isFinite(t) && t >= 1 ? z(Math.floor(t)) : "" });
		}}
            />
            <span>days from today</span>
          </label>` : null}
    `;
	}
	_patchRow(e, t) {
		this._patch({ customFields: this._model.customFields.map((n) => n.id === e ? {
			...n,
			...t
		} : n) });
	}
	_renderCustomFields() {
		let e = this._model.customFields, t = Object.keys(sr(this._model)).length, n = this.customFieldKeys.filter((t) => !e.some((e) => e.key === t)).slice(0, 3);
		return v`<div class="cell span3">
      <div class="custom">
        <div class="custom-head">
          <span class="hv-label">Custom fields</span>
          <span class="tally" data-testid="editor-cf-tally">
            ${t} of ${P(this.customFieldKeys.length || t, "key")} in use
          </span>
        </div>
        ${e.map((t) => {
			let n = this._errorFor(`custom:${t.id}`);
			return v`<div class="cf-row ${n ? "invalid" : ""}" data-testid="editor-cf-row" data-id=${t.id}>
            <input
              class="hv-input cf-key"
              data-testid="editor-cf-key"
              aria-label="Field key"
              placeholder="key"
              .value=${t.key}
              @input=${(e) => this._patchRow(t.id, { key: e.target.value })}
            />
            <select
              class="hv-input cf-type"
              data-testid="editor-cf-type"
              aria-label="Field type"
              @change=${(e) => this._patchRow(t.id, { type: e.target.value })}
            >
              ${yr.map((e) => v`<option value=${e.value} ?selected=${t.type === e.value}>${e.label}</option>`)}
            </select>
            ${t.type === "boolean" ? v`<button
                  class="toggle cf-value"
                  role="switch"
                  aria-checked=${String(t.value === "true")}
                  data-testid="editor-cf-value"
                  @click=${() => this._patchRow(t.id, { value: t.value === "true" ? "false" : "true" })}
                >
                  <span class="switch ${t.value === "true" ? "on" : ""}"></span>
                  <span>${t.value === "true" ? "Yes" : "No"}</span>
                </button>` : v`<input
                  class="hv-input cf-value"
                  data-testid="editor-cf-value"
                  aria-label="Field value"
                  type=${t.type === "number" ? "number" : t.type === "date" ? "date" : "text"}
                  .value=${t.value}
                  @input=${(e) => this._patchRow(t.id, { value: e.target.value })}
                />`}
            <button
              class="cf-remove"
              data-testid="editor-cf-remove"
              aria-label=${`Remove ${t.key || "field"}`}
              title="Remove field"
              @click=${() => this._patch({ customFields: e.filter((e) => e.id !== t.id) })}
            >
              ${j("close", 16)}
            </button>
            ${n ? v`<span class="field-error" data-testid="editor-cf-error">${n}</span>` : null}
          </div>`;
		})}
        <button
          class="cf-add"
          data-testid="editor-cf-add"
          @click=${() => this._patch({ customFields: [...e, nr()] })}
        >
          ${j("plus", 15)}Add field
        </button>
        ${n.length ? v`<span class="key-hints" data-testid="editor-cf-key-hints">
              Key suggestions:
              ${n.map((t) => v`<button
                  data-testid="editor-cf-key-hint"
                  data-value=${t}
                  @click=${() => this._patch({ customFields: [...e, nr({ key: t })] })}
                >
                  ${t}
                </button>`)}
              · Clearing a value unsets the key on save.
            </span>` : v`<span class="key-hints">Clearing a value unsets the key on save.</span>`}
      </div>
    </div>`;
	}
	_renderMoreFields() {
		let e = this._model, t = [
			e.description ? "description" : null,
			e.dueDate || e.inspectionDate ? "dates" : null,
			e.customFields.length ? `${e.customFields.length} custom` : null
		].filter(Boolean).join(" · ");
		return v`
      <button
        class="more-toggle"
        data-testid="editor-more-toggle"
        aria-expanded=${String(this._moreOpen)}
        @click=${() => {
			this._moreOpen = !this._moreOpen;
		}}
      >
        ${j(this._moreOpen ? "chevronDown" : "chevronRight", 19)} More fields
        <span class="summary">${t || "description · dates · custom fields"}</span>
      </button>
      ${this._moreOpen ? v`
            <div class="cell span3">
              <label class="hv-label" for="editor-description">Description</label>
              <textarea
                id="editor-description"
                class="hv-input"
                data-testid="editor-description"
                .value=${e.description}
                @input=${(e) => this._patch({ description: e.target.value })}
              ></textarea>
            </div>
            ${this._renderStateFields()} ${this._renderCustomFields()}
          ` : null}
    `;
	}
	render() {
		let e = this._model, t = this.item === null, n = R(this.item?.due_date);
		return v`
      <div data-testid="item-editor" @keydown=${this._onKeydown}>
        ${this.noHeader ? null : v`<div class="head">
              ${j("chevronDown", 18)}
              <span class="name" data-testid="editor-heading">
                ${t ? "New item" : `${this.item?.name} — editing`}
              </span>
              ${this.item?.checked_out ? v`<span class="out-chip ${n ? "overdue" : ""}" data-testid="editor-out-chip">
                    ${n ? "Overdue" : "Checked out"}${this.item?.due_date ? ` · due ${L(this.item.due_date)}` : ""}
                  </span>` : null}
              ${this.item ? v`<span class="meta" data-testid="editor-version"
                    >v${this.item.version} · updated ${bn(this.item.updated_at)}</span
                  >` : null}
              <button
                class="hv-icon-button"
                data-testid="editor-close"
                aria-label="Close editor"
                @click=${this._cancel}
              >
                ${j("close", 18)}
              </button>
            </div>`}
        ${this.errorMessage ? v`<div class="banner" role="alert" data-testid="editor-error">${this.errorMessage}</div>` : null}

        <div class="grid">
          ${this._text("name", "Name", { testid: "editor-name" })}
          ${this._text("quantity", "Quantity", {
			type: "number",
			testid: "editor-quantity"
		})}
          ${this._text("lowStock", "Low-stock at", {
			type: "number",
			testid: "editor-low-stock"
		})}
          ${this.mobile ? null : v`<div class="cell span3">
                <label class="hv-label" for="editor-description-desktop">Description</label>
                <textarea
                  id="editor-description-desktop"
                  class="hv-input"
                  data-testid="editor-description"
                  .value=${e.description}
                  @input=${(e) => this._patch({ description: e.target.value })}
                ></textarea>
              </div>`}
          ${this._renderLocationField()} ${this._renderCategoryField()}
          <div class="cell span3">
            <span class="hv-label">Tags <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--hv-text-tertiary)">· stored lowercase</span></span>
            <hv-chip-input
              data-testid="editor-tags"
              .values=${e.tags}
              .suggestions=${this.tagSuggestions}
              @change=${(e) => this._patch({ tags: e.detail.values })}
            ></hv-chip-input>
          </div>
          ${this.mobile ? v`<div class="cell span3">${this._renderMoreFields()}</div>` : v`${this._renderStateFields()} ${this._renderCustomFields()}`}

          <div class="cell span3 actions-cell">
            <div class="actions">
              ${this.item ? v`<button
                    class="hv-text-button danger"
                    data-testid="editor-delete"
                    @click=${() => this.dispatchEvent(new CustomEvent("delete-item", {
			detail: {
				itemId: this.item.id,
				name: this.item.name
			},
			bubbles: !0,
			composed: !0
		}))}
                  >
                    Delete item
                  </button>` : null}
              <span class="spacer"></span>
              ${this.mobile ? null : v`<span class="hint" data-testid="editor-key-hint">
                    Esc discards · ${Wt()} saves
                  </span>`}
              <button class="hv-text-button" data-testid="editor-cancel" @click=${this._cancel}>Cancel</button>
              <button class="save" data-testid="editor-save" ?disabled=${this.busy} @click=${this._save}>
                ${this.busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
	}
}, _r.styles = [
	O,
	k,
	o`
      :host {
        display: block;
        background: var(--hv-row-hover);
        border-left: 3px solid var(--hv-primary);
      }
      :host([mobile]) {
        background: transparent;
        border-left: none;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 18px 4px;
      }
      .head .name {
        font-size: 15px;
        font-weight: 500;
        color: var(--hv-primary-darker);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .head .meta {
        margin-left: auto;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
        white-space: nowrap;
      }
      .out-chip {
        flex: none;
        font: 500 11px var(--hv-font);
        color: var(--hv-primary-darker);
        background: var(--hv-surface);
        border: 1px solid var(--hv-primary-tint-border);
        border-radius: var(--hv-radius-chip);
        padding: 2px 8px;
      }
      .out-chip.overdue {
        color: #fff;
        background: var(--hv-error);
        border-color: var(--hv-error);
      }
      .grid {
        display: grid;
        grid-template-columns: 2fr 1fr 1fr;
        gap: 12px;
        padding: 8px 18px 14px;
      }
      :host([mobile]) .grid {
        grid-template-columns: 1fr;
        gap: 14px;
        padding: 14px 16px;
      }
      .cell.span2 {
        grid-column: span 2;
      }
      .cell.span3 {
        grid-column: span 3;
      }
      :host([mobile]) .cell.span2,
      :host([mobile]) .cell.span3 {
        grid-column: span 1;
      }
      .cell {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      /* Checked out and Due date are two halves of one fact; Next inspection is
         unrelated to both. The boxes below carry that split visually, so the
         three fields are never read as three peer settings of the same kind. */
      .state {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 12px;
        align-items: start;
      }
      :host([mobile]) .state {
        grid-template-columns: 1fr;
      }
      .group {
        display: grid;
        gap: 9px;
        min-width: 0;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        padding: 9px 11px 11px;
      }
      .group-caption {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--hv-text-secondary);
      }
      .group-caption .hv-icon {
        flex: none;
        opacity: 0.8;
      }
      .group-body {
        display: grid;
        gap: 12px;
        min-width: 0;
      }
      .checkout-body {
        grid-template-columns: 1fr 1fr;
        align-items: end;
      }
      /* Checking out is something you do, not a setting you hold — the same
         button the detail sheet has offered all along, in the same words. */
      .checkout-action {
        justify-content: center;
        gap: 7px;
        min-height: var(--hv-tap-min, auto);
        font-weight: 500;
        cursor: pointer;
      }
      .checkout-action:hover {
        background: var(--hv-row-hover);
      }
      .checkout-action .hv-icon {
        flex: none;
        opacity: 0.85;
      }
      .group-hint {
        font-size: 11.5px;
        line-height: 1.4;
        color: var(--hv-text-tertiary);
      }
      /* Same chips, same states as the check-out popover's: one gesture, so it
         must not look like two. */
      .offsets {
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
      }
      .offset {
        border: 1px solid var(--hv-divider);
        background: none;
        color: var(--hv-chip-text);
        border-radius: var(--hv-radius-chip);
        padding: 6px 13px;
        font: 400 12.5px var(--hv-font);
        cursor: pointer;
      }
      :host([mobile]) .offset {
        min-height: var(--hv-tap-min, auto);
        padding: 0 15px;
        font-size: 13.5px;
      }
      .offset.on {
        background: var(--hv-primary-dark);
        border-color: var(--hv-primary-dark);
        color: #fff;
        font-weight: 500;
      }
      .custom-days {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        font-size: 13px;
        color: var(--hv-text-secondary);
      }
      .custom-days input {
        width: 72px;
        box-sizing: border-box;
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        background: var(--hv-surface);
        color: var(--hv-text);
        padding: 5px 8px;
        font: 400 13.5px var(--hv-font);
      }
      :host([mobile]) .custom-days input {
        min-height: 44px;
        width: 88px;
        font-size: var(--hv-input-font, 14.5px);
      }
      /* A native date input clips its own placeholder much below ~140px, and
         half of a 375px screen minus the box padding is under that. */
      :host([mobile]) .checkout-body {
        grid-template-columns: 1fr;
      }
      label.hv-label {
        display: block;
      }
      .hv-input,
      .field-button {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        background: var(--hv-surface);
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        padding: 9px 11px;
        font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
        color: var(--hv-text);
      }
      :host([mobile]) .hv-input,
      :host([mobile]) .field-button {
        min-height: 48px;
        font-size: var(--hv-input-font, 14.5px);
      }
      /* A disabled date input keeps the browser's own colour, which against a
         dark HA theme is all but indistinguishable from an enabled one. */
      .hv-input:disabled {
        background: var(--hv-input-bg);
        border-color: var(--hv-divider);
        color: var(--hv-text-tertiary);
        -webkit-text-fill-color: var(--hv-text-tertiary);
        cursor: not-allowed;
      }
      .cell.muted .hv-label {
        color: var(--hv-text-tertiary);
      }
      textarea.hv-input {
        min-height: 44px;
        line-height: 1.5;
        resize: vertical;
      }
      .field-button {
        display: flex;
        align-items: center;
        gap: 8px;
        text-align: left;
      }
      .field-button .value {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .field-button.empty .value {
        color: var(--hv-text-tertiary);
      }
      .invalid .hv-input,
      .invalid .field-button {
        border-color: var(--hv-error);
      }
      .field-error {
        font-size: 12px;
        color: var(--hv-error);
      }
      .tree-holder,
      .list-holder {
        margin-top: 6px;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        background: var(--hv-surface);
        max-height: 220px;
        overflow: auto;
        padding: 4px 0;
      }
      /* The category list is the one holder that must NOT take part in the
         layout. In flow it grew its own grid cell, which grew the row, which
         stretched the Location button beside it to ~130px — the form visibly
         came apart every time the suggestions opened. The location tree below
         is the opposite case: it is meant to push the form open, so it keeps
         the in-flow rule above.

         Fixed rather than absolute, because the expanded view puts the whole
         form inside an editor-holder that is max-height 70dvh with
         overflow-y auto, and an absolute list would be clipped by it. Same
         technique the checkout popover and the overflow menu already use. */
      .list-holder.floating {
        position: fixed;
        margin-top: 0;
        box-shadow: var(--hv-shadow-menu);
      }
      /* The category field is a text input plus its own dropdown affordance —
         without the arrow the existing values were only findable by guessing. */
      .combo {
        position: relative;
        display: flex;
        align-items: center;
      }
      .combo .hv-input {
        padding-right: 34px;
      }
      .combo-arrow {
        position: absolute;
        right: 4px;
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--hv-text-tertiary);
        padding: 0;
      }
      .combo-arrow:hover {
        background: var(--hv-hover-overlay);
      }
      :host([mobile]) .combo-arrow {
        right: 2px;
        width: var(--hv-tap-min, 32px);
        height: var(--hv-tap-min, 32px);
      }
      .option {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        box-sizing: border-box;
        border: none;
        background: none;
        text-align: left;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
        padding: 7px 12px;
        border-radius: var(--hv-radius-input);
      }
      .option .label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .option:hover,
      .option.active {
        background: var(--hv-hover-overlay);
      }
      .option.selected {
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
        font-weight: 500;
      }
      .option.active {
        box-shadow: inset 0 0 0 1px var(--hv-primary);
      }
      .option-empty {
        padding: 8px 12px;
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
      }
      .toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: var(--hv-tap-min, auto);
        border: none;
        background: none;
        padding: 9px 0;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
      }
      .switch {
        width: 34px;
        height: 18px;
        border-radius: 999px;
        background: var(--hv-divider);
        position: relative;
        flex: none;
        transition: background var(--hv-motion-fast) ease-out;
      }
      .switch.on {
        background: var(--hv-primary);
      }
      .switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        transition: transform var(--hv-motion-fast) ease-out;
      }
      .switch.on::after {
        transform: translateX(16px);
      }
      .custom {
        border-top: 1px solid var(--hv-divider);
        padding-top: 12px;
        display: grid;
        gap: 8px;
        /* The rows size themselves from the room they actually have. The mobile
           flag describes the *card*, and the same editor runs inside a desktop
           row and inside a sheet far wider than the card that opened it. */
        container-type: inline-size;
      }
      .custom-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .custom-head .tally {
        margin-left: auto;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      .cf-row {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) 110px minmax(0, 1.6fr) var(--hv-tap-min, 34px);
        gap: 8px;
        align-items: center;
      }
      /* No named area: it auto-places into the row below whatever came before. */
      .cf-row .field-error {
        grid-column: 1 / -1;
      }
      /* Too tight for one line: the value drops under its key, and the remove
         button spans both rows so it still reads as belonging to that field
         rather than floating under the one before it. */
      @container (max-width: 520px) {
        .cf-row {
          grid-template-columns: minmax(0, 1fr) 104px var(--hv-tap-min, 34px);
          grid-template-areas:
            'key type remove'
            'value value remove';
        }
        .cf-row .cf-key {
          grid-area: key;
        }
        .cf-row .cf-type {
          grid-area: type;
        }
        .cf-row .cf-value {
          grid-area: value;
        }
        .cf-row .cf-remove {
          grid-area: remove;
        }
      }
      .cf-remove {
        display: inline-grid;
        place-items: center;
        width: var(--hv-tap-min, 30px);
        height: var(--hv-tap-min, 30px);
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--hv-text-tertiary);
        padding: 0;
      }
      .cf-remove:hover {
        background: var(--hv-hover-overlay);
      }
      .cf-add {
        justify-self: start;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: var(--hv-tap-min, auto);
        border: 1px dashed var(--hv-primary-tint-border);
        background: none;
        color: var(--hv-primary-dark);
        border-radius: var(--hv-radius-input);
        padding: 8px 13px;
        font: 500 12.5px var(--hv-font);
      }
      .key-hints {
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      .key-hints button {
        border: none;
        background: none;
        padding: 0 2px;
        font: inherit;
        color: var(--hv-primary-dark);
      }
      /* These sit inline inside a sentence, so they get height and breathing
         room rather than becoming blocks that break the line up. */
      :host([mobile]) .key-hints button {
        display: inline-flex;
        align-items: center;
        min-height: var(--hv-tap-min, auto);
        padding: 0 8px;
      }
      .more-toggle {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: var(--hv-tap-min, auto);
        border: none;
        border-top: 1px solid var(--hv-divider);
        background: none;
        padding: 12px 0 0;
        font: 500 14.5px var(--hv-font);
        color: var(--hv-text);
        text-align: left;
      }
      .more-toggle .summary {
        margin-left: auto;
        font: 400 12px var(--hv-font);
        color: var(--hv-text-secondary);
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-top: 4px;
        flex-wrap: wrap;
      }
      /* Save and Cancel sat at the bottom of a form inside a nested scroller,
         so on a phone they were reliably below the fold — you had to scroll an
         inner container to commit an edit you had already finished.
         Sticky goes on the wrapping cell rather than on .actions itself: an
         element only sticks within its containing block, and .actions' parent
         is exactly as tall as .actions, so it would have had nowhere to move.
         The cell's containing block is the form grid, which is tall. */
      :host([mobile]) .actions-cell {
        position: sticky;
        bottom: -14px;
        z-index: 1;
        background: var(--hv-surface);
        padding: 10px 0 14px;
        border-top: 1px solid var(--hv-row-divider);
      }
      /* The auto margin lives on a spacer of its own, not on the hint: the hint
         is gone on a phone (no keyboard to press Esc with), and with the margin
         attached to it Cancel and Save fell back to the left edge — right next
         to Delete. */
      .actions .spacer {
        margin-left: auto;
      }
      .actions .hint {
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      /* The property that drops the hint describes how wide the surface is,
         and turning a phone sideways makes it 760px wide — so the expanded
         view went back to telling a screen with no keyboard on it to press Esc
         and Ctrl+Enter. Whether there is a keyboard to press was never a width
         question, so ask the pointer instead: coarse in both orientations,
         fine on the desktop where the hint belongs. The chords themselves stay
         bound either way, for a phone that is docked to a keyboard. */
      @media (hover: none), (pointer: coarse) {
        .actions .hint {
          display: none;
        }
      }
      .save {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: var(--hv-tap-min, auto);
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        padding: 8px 20px;
        font: 500 13px var(--hv-font);
      }
      .save[disabled] {
        opacity: 0.5;
      }
      /* Delete is hv-text-button danger from the shared sheet — the same
         borderless red every other destructive action in the card uses (the
         detail sheet's own Delete item, the organize dialog's Delete). It used
         to be an outlined 12.5px pill, which made it the one button in the row
         with a border, its own radius and its own font size. */
      .banner {
        margin: 0 18px;
        padding: 9px 12px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-error-bg);
        color: var(--hv-error-deep);
        font-size: 12.5px;
      }
    `
], _r);
N([E({ attribute: !1 })], K.prototype, "item", void 0), N([E({ attribute: !1 })], K.prototype, "locations", void 0), N([E({ attribute: !1 })], K.prototype, "locationTree", void 0), N([E({ attribute: !1 })], K.prototype, "categorySuggestions", void 0), N([E({ attribute: !1 })], K.prototype, "tagSuggestions", void 0), N([E({ attribute: !1 })], K.prototype, "customFieldKeys", void 0), N([E({
	type: Boolean,
	reflect: !0
})], K.prototype, "mobile", void 0), N([E({ type: Boolean })], K.prototype, "busy", void 0), N([E({ type: String })], K.prototype, "errorMessage", void 0), N([E({ type: Boolean })], K.prototype, "noHeader", void 0), N([D()], K.prototype, "_model", void 0), N([D()], K.prototype, "_errors", void 0), N([D()], K.prototype, "_showErrors", void 0), N([D()], K.prototype, "_locationOpen", void 0), N([D()], K.prototype, "_moreOpen", void 0), N([D()], K.prototype, "_categoryOpen", void 0), N([D()], K.prototype, "_categoryShowAll", void 0), N([D()], K.prototype, "_categoryIndex", void 0), N([D()], K.prototype, "_categoryBox", void 0), N([D()], K.prototype, "_checkoutOpen", void 0), N([D()], K.prototype, "_checkoutAnchor", void 0), N([D()], K.prototype, "_inspectionCustomOpen", void 0), N([D()], K.prototype, "_inspectionCustomDays", void 0), K = N([T("hv-item-editor")], K);
//#endregion
//#region src/components/hv-detail-sheet.ts
var br, q = (br = class extends b {
	constructor(...e) {
		super(...e), this.item = null, this.open = !1, this.locations = null, this.locationTree = [], this.categorySuggestions = [], this.tagSuggestions = [], this.customFieldKeys = [], this.busy = !1, this.errorMessage = null, this._mode = "read", this._checkoutOpen = !1, this._close = () => {
			this.open = !1, this.dispatchEvent(new CustomEvent("cancel", {
				bubbles: !0,
				composed: !0
			}));
		};
	}
	willUpdate(e) {
		(e.has("item") || e.has("open") && this.open) && (this._mode = "read", this._checkoutOpen = !1);
	}
	get dirty() {
		return this._mode === "edit" ? this._editor?.dirty ?? !1 : !1;
	}
	get _editor() {
		return this.shadowRoot?.querySelector("hv-item-editor") ?? null;
	}
	_emit(e, t = {}) {
		this.dispatchEvent(new CustomEvent(e, {
			detail: {
				itemId: this.item?.id,
				...t
			},
			bubbles: !0,
			composed: !0
		}));
	}
	_renderCustomFact(e, t) {
		let n = rr(t);
		if (n === "boolean") {
			let n = t === !0;
			return v`<div class="fact" data-testid="sheet-fact" data-key=${e}>
        <span>${e}</span>
        <span class="value ${n ? "yes" : "unset"}">
          ${n ? v`${j("check", 15)} Yes` : "No"}
        </span>
      </div>`;
		}
		return v`<div class="fact" data-testid="sheet-fact" data-key=${e}>
      <span>${e}</span>
      <span class="value">${n === "date" ? L(String(t)) : String(t)}</span>
    </div>`;
	}
	_renderRead(e) {
		let t = Yn(e), n = R(e.due_date), r = R(e.inspection_date), i = Xn(e), a = Object.entries(e.custom_fields ?? {});
		return v`
      <div class="bar">
        <button class="tap" data-testid="sheet-close" aria-label="Close" @click=${this._close}>
          ${j("close", 22)}
        </button>
        <span class="crumb" data-testid="sheet-path">${i || "No location"}</span>
        <button
          class="text-action"
          data-testid="sheet-edit"
          @click=${() => {
			this._mode = "edit";
		}}
        >
          Edit
        </button>
      </div>

      <div class="title">
        <h2 data-testid="sheet-name">${e.name}</h2>
        <div class="chips">
          ${t ? v`<span class="chip low" data-testid="sheet-low">LOW</span>` : null}
          ${e.checked_out ? v`<span class="chip state ${n ? "overdue" : ""}" data-testid="sheet-out">
                ${n ? "Overdue" : "Checked out"}${e.due_date ? ` · due ${L(e.due_date)}` : ""}
              </span>` : null}
          ${r ? v`<span class="chip inspect" data-testid="sheet-inspection-due">
                Inspection due · ${L(e.inspection_date)}
              </span>` : null}
          ${e.category ? v`<span class="chip" data-testid="sheet-category">${e.category}</span>` : null}
          ${e.tags.map((e) => v`<span class="chip" data-testid="sheet-tag">${e}</span>`)}
        </div>
      </div>

      <div class="hero">
        <button
          class="minus"
          data-testid="sheet-decrement"
          aria-label="Decrease quantity"
          ?disabled=${e.checked_out || e.quantity <= 0}
          @click=${() => this._emit("decrement")}
        >
          ${j("minus", 22)}
        </button>
        <span class="readout">
          <span class="qty ${t ? "low" : ""}" data-testid="sheet-qty">${e.quantity}</span>
          ${e.low_stock_threshold === null ? null : v`<span class="caption" data-testid="sheet-threshold"
                >low-stock at ${e.low_stock_threshold}</span
              >`}
        </span>
        <button
          class="plus"
          data-testid="sheet-increment"
          aria-label="Increase quantity"
          ?disabled=${e.checked_out}
          @click=${() => this._emit("increment")}
        >
          ${j("plus", 22)}
        </button>
      </div>

      ${e.description ? v`<div class="description" data-testid="sheet-description">${e.description}</div>` : null}

      <div class="facts">
        <div class="fact" data-testid="sheet-fact" data-key="due">
          <span>Due</span>
          <span class="value ${e.due_date ? "" : "unset"}">${e.due_date ? L(e.due_date) : "Not set"}</span>
        </div>
        <div class="fact" data-testid="sheet-fact" data-key="inspection">
          <span>Next inspection</span>
          <span class="value ${e.inspection_date ? "" : "unset"} ${r ? "late" : ""}"
            >${e.inspection_date ? L(e.inspection_date) : "Not set"}</span
          >
        </div>
        ${a.map(([e, t]) => this._renderCustomFact(e, t))}
        <div class="fact" data-testid="sheet-fact" data-key="updated">
          <span>Updated</span>
          <span class="value" data-testid="sheet-updated"
            >${bn(e.updated_at)} · v${e.version}</span
          >
        </div>
      </div>

      ${this._checkoutOpen ? v`<div style="padding: 0 14px 14px">
            <hv-checkout-popover
              mobile
              open
              data-testid="sheet-checkout"
              .item=${e}
              .mode=${e.checked_out ? "set-due-date" : "check-out"}
              @check-out=${(e) => {
			this._checkoutOpen = !1, this._emit("check-out-confirmed", { dueDate: e.detail.dueDate });
		}}
              @set-due-date=${(e) => {
			this._checkoutOpen = !1, this._emit("set-due-date", { dueDate: e.detail.dueDate });
		}}
              @cancel=${() => {
			this._checkoutOpen = !1;
		}}
            ></hv-checkout-popover>
          </div>` : null}

      <div class="actions">
        <div class="pair">
          ${e.checked_out ? v`<button class="outline" data-testid="sheet-check-in" @click=${() => this._emit("check-in")}>
                ${j("account", 18)}Check in
              </button>` : v`<button
                class="outline"
                data-testid="sheet-check-out"
                @click=${() => {
			this._checkoutOpen = !0;
		}}
              >
                ${j("account", 18)}Check out
              </button>`}
          <button
            class="primary"
            data-testid="sheet-edit-details"
            @click=${() => {
			this._mode = "edit";
		}}
          >
            ${j("pencil", 18)}Edit details
          </button>
        </div>
        <button class="danger" data-testid="sheet-delete" @click=${() => this._emit("request-delete")}>
          Delete item
        </button>
      </div>
    `;
	}
	_renderEdit(e) {
		return v`
      <div class="bar edit">
        <button
          class="tap"
          data-testid="sheet-back"
          aria-label="Back"
          @click=${() => {
			this._mode = "read";
		}}
        >
          ${j("arrowLeft", 21)}
        </button>
        <span class="heading">Edit item</span>
        <button
          class="save"
          data-testid="sheet-save"
          ?disabled=${this.busy}
          @click=${() => this._editor?.shadowRoot?.querySelector("[data-testid=\"editor-save\"]")?.click()}
        >
          ${this.busy ? "Saving…" : "Save"}
        </button>
      </div>
      <hv-item-editor
        data-testid="sheet-editor"
        mobile
        noHeader
        .item=${e}
        .locations=${this.locations}
        .locationTree=${this.locationTree}
        .categorySuggestions=${this.categorySuggestions}
        .tagSuggestions=${this.tagSuggestions}
        .customFieldKeys=${this.customFieldKeys}
        .busy=${this.busy}
        .errorMessage=${this.errorMessage}
        @cancel=${() => {
			this._mode = "read";
		}}
        @delete-item=${(e) => {
			e.stopPropagation(), this._emit("request-delete");
		}}
      ></hv-item-editor>
    `;
	}
	render() {
		let e = this.item;
		return v`<hv-bottom-sheet
      data-testid="detail-sheet"
      ?open=${this.open && !!e}
      ?noHandle=${this._mode === "edit"}
      label=${e?.name ?? "Item"}
      @cancel=${this._close}
    >
      ${e ? this._mode === "edit" ? this._renderEdit(e) : this._renderRead(e) : null}
    </hv-bottom-sheet>`;
	}
}, br.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px 6px 4px;
      }
      .bar.edit {
        border-bottom: 1px solid var(--hv-row-divider);
      }
      .bar .crumb {
        flex: 1;
        min-width: 0;
        /* This and the quantity below are the two things the read view is for,
           and they were 12.5px and 34px — a factor of 2.7 apart, with the path
           the smallest text on the sheet and the number half again bigger than
           anything else on it. Both now sit on the sheet's own scale: the path
           reads at body size, like the description under it. */
        font-size: 13.5px;
        color: var(--hv-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .bar .heading {
        flex: 1;
        font-size: 16px;
        font-weight: 500;
      }
      .bar button.tap {
        min-width: 44px;
        min-height: 44px;
        border: none;
        background: none;
        color: var(--hv-text-secondary);
        display: inline-grid;
        place-items: center;
        border-radius: 50%;
      }
      .bar .text-action {
        border: none;
        background: none;
        color: var(--hv-primary-dark);
        min-height: 44px;
        padding: 0 14px;
        font: 500 14px var(--hv-font);
      }
      .bar .save {
        border: none;
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        border-radius: var(--hv-radius-chip);
        height: 40px;
        padding: 0 20px;
        margin-right: 8px;
        font: 500 14px var(--hv-font);
      }
      .title {
        padding: 2px 18px 10px;
      }
      .title h2 {
        margin: 0;
        font-size: 22px;
        font-weight: 500;
        line-height: 1.25;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      .chip {
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-chip-bg);
        color: var(--hv-chip-text);
        padding: 3px 9px;
        font: 400 11.5px var(--hv-font);
      }
      .chip.state {
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
      }
      .chip.overdue {
        background: var(--hv-error);
        color: #fff;
      }
      .chip.low {
        background: var(--hv-warn-bg);
        color: var(--hv-warn);
        font-weight: 700;
        letter-spacing: 0.4px;
      }
      /* Amber, not the red the overdue chip takes: red on this card means an
         item is out and late back, while an inspection that has come due is a
         chore on something still on the shelf — the same kind of signal as low
         stock. Keeping the two hues apart is what lets both chips sit in this
         row without reading as one alarm. */
      .chip.inspect {
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
        font-weight: 500;
      }
      .hero {
        margin: 0 14px 14px;
        background: var(--hv-surface-raised);
        border-radius: 14px;
        padding: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
      }
      .hero button {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        display: inline-grid;
        place-items: center;
        flex: none;
        padding: 0;
      }
      .hero .minus {
        border: 1px solid var(--hv-input-border);
        background: none;
        color: var(--hv-text);
      }
      .hero .plus {
        border: none;
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
      }
      .hero button[disabled] {
        opacity: 0.4;
      }
      .hero .readout {
        text-align: center;
        min-width: 90px;
      }
      .hero .qty {
        /* The top of the sheet's scale, which is the item's own name — the
           readout is still the biggest number on the surface and still the
           thing the two 52px buttons point at, without out-shouting the item
           it belongs to. See the note on .bar .crumb. */
        font-size: 22px;
        font-weight: 500;
        line-height: 1;
      }
      .hero .qty.low {
        color: var(--hv-warn);
      }
      .hero .caption {
        font-size: 11.5px;
        color: var(--hv-text-secondary);
        margin-top: 6px;
      }
      .description {
        padding: 0 18px 12px;
        font-size: 13.5px;
        line-height: 1.55;
        color: var(--hv-text-secondary);
      }
      .facts {
        display: grid;
        gap: 1px;
        background: var(--hv-row-divider);
      }
      .fact {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        padding: 8px 18px;
        background: var(--hv-surface);
        font-size: 13.5px;
        color: var(--hv-text-secondary);
      }
      .fact .value {
        margin-left: auto;
        color: var(--hv-text);
        text-align: right;
      }
      .fact .value.unset {
        color: var(--hv-text-tertiary);
      }
      .fact .value.yes {
        color: var(--hv-success);
      }
      /* An inspection date that has passed asks for something to be done, so
         it does not read as a neutral fact. Same amber as the chip above it. */
      .fact .value.late {
        color: var(--hv-warn-deep);
        font-weight: 500;
      }
      .actions {
        display: grid;
        gap: 9px;
        padding: 12px 14px 16px;
      }
      .actions .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .actions .outline {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 50px;
        border: 1px solid var(--hv-input-border);
        background: none;
        color: var(--hv-text);
        border-radius: var(--hv-radius-chip);
        font: 500 14.5px var(--hv-font);
      }
      .actions .primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 50px;
        border: none;
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        border-radius: var(--hv-radius-chip);
        font: 500 14.5px var(--hv-font);
      }
      .actions .danger {
        min-height: 48px;
        border: none;
        background: none;
        color: var(--hv-error-soft);
        font: 400 14px var(--hv-font);
      }
    `
], br);
N([E({ attribute: !1 })], q.prototype, "item", void 0), N([E({
	type: Boolean,
	reflect: !0
})], q.prototype, "open", void 0), N([E({ attribute: !1 })], q.prototype, "locations", void 0), N([E({ attribute: !1 })], q.prototype, "locationTree", void 0), N([E({ attribute: !1 })], q.prototype, "categorySuggestions", void 0), N([E({ attribute: !1 })], q.prototype, "tagSuggestions", void 0), N([E({ attribute: !1 })], q.prototype, "customFieldKeys", void 0), N([E({ type: Boolean })], q.prototype, "busy", void 0), N([E({ type: String })], q.prototype, "errorMessage", void 0), N([D()], q.prototype, "_mode", void 0), N([D()], q.prototype, "_checkoutOpen", void 0), q = N([T("hv-detail-sheet")], q);
//#endregion
//#region src/components/hv-bulk-bar.ts
var xr, Sr = [
	{
		id: "move",
		label: "Move to…",
		glyph: "mapMarker"
	},
	{
		id: "add-tags",
		label: "Add tags…"
	},
	{
		id: "remove-tags",
		label: "Remove tags…"
	},
	{
		id: "set-category",
		label: "Set category…"
	},
	{
		id: "adjust-qty",
		label: "Adjust qty…"
	},
	{
		id: "check-out",
		label: "Check out",
		immediate: !0
	},
	{
		id: "check-in",
		label: "Check in",
		immediate: !0
	}
], J = (xr = class extends b {
	constructor(...e) {
		super(...e), this.selectedCount = 0, this.selectedItems = [], this.locationTree = [], this.distinct = null, this.progress = null, this.result = null, this._active = null, this._tags = [], this._draft = "";
	}
	_run(e) {
		this._active = null, this._tags = [], this._draft = "", this.dispatchEvent(new CustomEvent("run", {
			detail: e,
			bubbles: !0,
			composed: !0
		}));
	}
	_renderPicker() {
		switch (this._active) {
			case "move": return v`<div class="picker" data-testid="bulk-picker" data-picker="move">
          <span class="hv-label">Move ${P(this.selectedCount, "item")} to</span>
          <div class="tree-holder">
            <hv-location-tree
              data-testid="bulk-location-tree"
              .nodes=${this.locationTree}
              showAll
              @select=${(e) => this._run({
				action: "move",
				locationId: e.detail.locationId
			})}
            ></hv-location-tree>
          </div>
        </div>`;
			case "add-tags":
			case "remove-tags": {
				let e = this._active === "add-tags";
				return v`<div class="picker" data-testid="bulk-picker" data-picker=${this._active}>
          <span class="hv-label">${e ? "Add tags to" : "Remove tags from"} ${P(this.selectedCount, "item")}</span>
          <hv-chip-input
            data-testid="bulk-tags"
            .values=${this._tags}
            .suggestions=${(this.distinct?.tags ?? []).map((e) => e.value)}
            @change=${(e) => {
					this._tags = e.detail.values;
				}}
          ></hv-chip-input>
          <div class="row">
            <button class="hv-text-button" data-testid="bulk-picker-cancel" @click=${() => this._active = null}>
              Cancel
            </button>
            <button
              class="hv-pill"
              data-testid="bulk-picker-apply"
              ?disabled=${this._tags.length === 0}
              @click=${() => this._run({
					action: e ? "add-tags" : "remove-tags",
					tags: this._tags
				})}
            >
              ${e ? "Add" : "Remove"}
            </button>
          </div>
        </div>`;
			}
			case "set-category": return v`<div class="picker" data-testid="bulk-picker" data-picker="set-category">
          <span class="hv-label">Set the category on ${P(this.selectedCount, "item")}</span>
          <div class="row">
            <input
              data-testid="bulk-category"
              list="hv-bulk-categories"
              placeholder="Category (blank clears it)"
              .value=${this._draft}
              @input=${(e) => {
				this._draft = e.target.value;
			}}
            />
            <datalist id="hv-bulk-categories">
              ${(this.distinct?.categories ?? []).map((e) => v`<option value=${e.value}></option>`)}
            </datalist>
            <button class="hv-text-button" data-testid="bulk-picker-cancel" @click=${() => this._active = null}>
              Cancel
            </button>
            <button
              class="hv-pill"
              data-testid="bulk-picker-apply"
              @click=${() => this._run({
				action: "set-category",
				category: this._draft.trim() || null
			})}
            >
              Set
            </button>
          </div>
        </div>`;
			case "adjust-qty": return v`<div class="picker" data-testid="bulk-picker" data-picker="adjust-qty">
          <span class="hv-label">Adjust the quantity of ${P(this.selectedCount, "item")} by</span>
          <div class="row">
            <input
              type="number"
              data-testid="bulk-delta"
              placeholder="e.g. -1"
              .value=${this._draft}
              @input=${(e) => {
				this._draft = e.target.value;
			}}
            />
            <button class="hv-text-button" data-testid="bulk-picker-cancel" @click=${() => this._active = null}>
              Cancel
            </button>
            <button
              class="hv-pill"
              data-testid="bulk-picker-apply"
              ?disabled=${!Number.isFinite(Number(this._draft)) || this._draft.trim() === "" || Number(this._draft) === 0}
              @click=${() => this._run({
				action: "adjust-qty",
				delta: Number(this._draft)
			})}
            >
              Apply
            </button>
          </div>
        </div>`;
			default: return null;
		}
	}
	_renderProgress(e) {
		let t = e.total ? Math.round(e.done / e.total * 100) : 0;
		return v`<div class="progress" data-testid="bulk-progress">
      <div class="line">
        <span data-testid="bulk-progress-label">${e.label} ${e.done} of ${e.total}</span>
        ${e.failed > 0 ? v`<span style="margin-left:auto;opacity:.8" data-testid="bulk-progress-failed"
              >${e.failed} failed</span
            >` : null}
        <button
          style="margin-left:${e.failed > 0 ? "8px" : "auto"}"
          data-testid="bulk-cancel"
          @click=${() => this.dispatchEvent(new CustomEvent("cancel-run", {
			bubbles: !0,
			composed: !0
		}))}
        >
          Cancel
        </button>
      </div>
      <div class="track"><div class="fill" style="width: ${t}%"></div></div>
    </div>`;
	}
	_renderResult(e) {
		let t = e.failed.length, n = t === 0;
		return v`<div class="result" data-testid="bulk-result">
      <div class="result-head">
        <span class="glyph" style="color: var(--hv-${n ? "success" : "warn"})">
          ${j(n ? "checkCircle" : "alert", 18)}
        </span>
        <div>
          <div class="title" data-testid="bulk-result-title">
            ${n ? `${e.label} finished` : `${e.label} finished with errors`}
          </div>
          <div class="sub" data-testid="bulk-result-summary">
            ${e.succeeded} of ${e.succeeded + t} succeeded.
            ${n ? "" : `${t} failed and ${en(t, "was", "were")} left unchanged.`}
          </div>
        </div>
      </div>
      ${t ? v`<div class="failures">
            ${e.failed.map((e) => v`<div class="failure" data-testid="bulk-failure" data-item-id=${e.itemId ?? ""}>
                <span class="glyph">${j("alertCircle", 17)}</span>
                <div>
                  <div class="name">${this._nameFor(e)}</div>
                  <div class="reason">${Cr(e)}</div>
                </div>
              </div>`)}
          </div>` : null}
      <div class="result-foot">
        <span class="hint">
          ${t ? `Selection kept to the ${P(t, "failed row")}` : ""}
        </span>
        <button
          class="hv-text-button"
          data-testid="bulk-result-dismiss"
          @click=${() => this.dispatchEvent(new CustomEvent("dismiss-result", {
			bubbles: !0,
			composed: !0
		}))}
        >
          Dismiss
        </button>
        ${t ? v`<button
              class="hv-pill"
              data-testid="bulk-retry"
              @click=${() => this.dispatchEvent(new CustomEvent("retry-failed", {
			bubbles: !0,
			composed: !0
		}))}
            >
              Retry ${t} failed
            </button>` : null}
      </div>
    </div>`;
	}
	_nameFor(e) {
		return this.selectedItems.find((t) => t.id === e.itemId)?.name ?? e.itemId ?? "Item";
	}
	render() {
		return this.result ? this._renderResult(this.result) : this.progress ? this._renderProgress(this.progress) : this.selectedCount === 0 ? null : v`
      ${this._renderPicker()}
      <div class="bar" data-testid="bulk-bar" role="toolbar" aria-label="Bulk actions">
        <span class="lead" data-testid="bulk-lead">Apply to ${P(this.selectedCount, "item")}</span>
        ${Sr.map((e) => v`<button
            class=${this._active === e.id ? "active" : ""}
            data-testid="bulk-action"
            data-action=${e.id}
            @click=${() => {
			e.immediate ? this._run(e.id === "check-out" ? {
				action: "check-out",
				dueDate: null
			} : { action: e.id }) : (this._active = this._active === e.id ? null : e.id, this._tags = [], this._draft = "");
		}}
          >
            ${e.glyph ? j(e.glyph, 15) : null}${e.label}
          </button>`)}
        <button class="danger" data-testid="bulk-action" data-action="delete" @click=${() => this._run({ action: "delete" })}>
          ${j("del", 15)}Delete
        </button>
      </div>
    `;
	}
}, xr.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .picker {
        padding: 12px 16px;
        background: var(--hv-surface);
        border-top: 1px solid var(--hv-divider);
        display: grid;
        gap: 8px;
      }
      .picker .row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .picker input {
        box-sizing: border-box;
        background: var(--hv-surface);
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        padding: 8px 10px;
        font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
        color: var(--hv-text);
        min-width: 180px;
      }
      .tree-holder {
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        max-height: 220px;
        overflow: auto;
        padding: 4px 0;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 12px 16px;
        background: #263238;
        color: #fff;
      }
      .bar .lead {
        font: 500 13px var(--hv-font);
        margin-right: 4px;
      }
      .bar button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: none;
        border-radius: var(--hv-radius-chip);
        background: rgba(255, 255, 255, 0.14);
        color: #fff;
        padding: 7px 14px;
        font: 400 12.5px var(--hv-font);
      }
      .bar button:hover {
        background: rgba(255, 255, 255, 0.24);
      }
      .bar button.active {
        background: rgba(255, 255, 255, 0.32);
      }
      .bar button.danger {
        margin-left: auto;
        background: none;
        border: 1px solid rgba(239, 83, 80, 0.7);
        color: #ef9a9a;
        font-weight: 500;
      }
      .progress {
        padding: 12px 16px;
        background: #263238;
        color: #fff;
        display: grid;
        gap: 8px;
      }
      .progress .line {
        display: flex;
        align-items: center;
        gap: 8px;
        font: 400 12.5px var(--hv-font);
      }
      .track {
        height: 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.2);
        overflow: hidden;
      }
      .fill {
        height: 100%;
        background: var(--hv-primary);
        transition: width var(--hv-motion-panel) ease-out;
      }
      .result {
        background: var(--hv-surface);
        border-top: 1px solid var(--hv-divider);
      }
      .result-head {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 14px 18px 10px;
        border-bottom: 1px solid var(--hv-row-divider);
      }
      .result-head .title {
        font: 500 15px var(--hv-font);
        color: var(--hv-text);
      }
      .result-head .sub {
        font-size: 13px;
        color: var(--hv-text-secondary);
        margin-top: 2px;
      }
      .failures {
        display: grid;
        gap: 1px;
        background: var(--hv-row-divider);
        max-height: 220px;
        overflow-y: auto;
      }
      .failure {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 18px;
        background: var(--hv-surface);
      }
      .failure .glyph {
        color: var(--hv-error);
        flex: none;
        margin-top: 1px;
      }
      .failure .name {
        font: 500 13.5px var(--hv-font);
        color: var(--hv-text);
      }
      .failure .reason {
        font-size: 12px;
        color: var(--hv-error);
        line-height: 1.45;
      }
      .result-foot {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 18px;
        border-top: 1px solid var(--hv-row-divider);
      }
      .result-foot .hint {
        font-size: 12px;
        color: var(--hv-text-tertiary);
        margin-right: auto;
      }
    `
], xr);
N([E({ type: Number })], J.prototype, "selectedCount", void 0), N([E({ attribute: !1 })], J.prototype, "selectedItems", void 0), N([E({ attribute: !1 })], J.prototype, "locationTree", void 0), N([E({ attribute: !1 })], J.prototype, "distinct", void 0), N([E({ attribute: !1 })], J.prototype, "progress", void 0), N([E({ attribute: !1 })], J.prototype, "result", void 0), N([D()], J.prototype, "_active", void 0), N([D()], J.prototype, "_tags", void 0), N([D()], J.prototype, "_draft", void 0), J = N([T("hv-bulk-bar")], J);
function Cr(e) {
	let { code: t, message: n } = e.error;
	switch (t) {
		case "conflict": return "Conflict — changed by another client since you loaded it.";
		case "not_found": return "Not found — deleted before this ran.";
		case "rate_limited": return "Rate limited — try again in a few seconds.";
		case "validation_error": return `Rejected — ${n}`;
		case "storage_error": return "Couldn't save — the integration failed to write to storage.";
		default: return n || "Failed.";
	}
}
//#endregion
//#region src/components/hv-data-table.ts
var wr, Tr = (wr = class extends b {
	constructor(...e) {
		super(...e), this.items = [], this.columns = [], this.selectable = !1, this.selection = /* @__PURE__ */ new Set();
	}
	get _columns() {
		return w(this.columns);
	}
	_emit(e, t = {}) {
		this.dispatchEvent(new CustomEvent(e, {
			detail: t,
			bubbles: !0,
			composed: !0
		}));
	}
	_onSort(e) {
		let t = this.sort?.field === e ? this.sort.order === "asc" ? "desc" : "asc" : Ze(e);
		this._emit("sort-change", { sort: {
			field: e,
			order: t
		} });
	}
	_sortHeader(e, t) {
		let n = this.sort?.field === e;
		return v`<button
      class="sort ${n ? "sorted" : ""}"
      data-testid="table-sort"
      data-field=${e}
      aria-sort=${n ? this.sort.order === "asc" ? "ascending" : "descending" : "none"}
      @click=${() => this._onSort(e)}
    >
      ${t}${n ? j(this.sort.order === "asc" ? "chevronUp" : "chevronDown", 14) : null}
    </button>`;
	}
	_cell(e, t) {
		switch (t) {
			case "quantity": return v`<span class="cell qty ${Yn(e) ? "low" : ""}" data-testid="cell-quantity"
          >${e.quantity}</span
        >`;
			case "category": return v`<span class="cell" data-testid="cell-category" title=${e.category ?? ""}>${e.category || "—"}</span>`;
			case "location": return v`<span class="cell" data-testid="cell-location" title=${Xn(e) ?? ""}>${Xn(e) || "—"}</span>`;
			case "tags": return v`<span class="tags" data-testid="cell-tags">
          ${e.tags.length ? e.tags.map((e) => v`<span class="tag">${e}</span>`) : v`<span class="cell">—</span>`}
        </span>`;
			case "due_date": return v`<span
          class="cell due ${R(e.due_date) ? "overdue" : ""}"
          data-testid="cell-due_date"
          >${L(e.due_date)}</span
        >`;
			case "inspection_date": return v`<span
          class="cell inspection ${R(e.inspection_date) ? "due" : ""}"
          data-testid="cell-inspection_date"
          >${L(e.inspection_date)}</span
        >`;
			case "updated_at": return v`<span class="cell updated" data-testid="cell-updated_at">${bn(e.updated_at)}</span>`;
		}
	}
	render() {
		let e = this._columns, t = Dt(e, { selectable: this.selectable }), n = this.items.map((e) => e.id), r = n.filter((e) => this.selection.has(e)).length, i = n.length > 0 && r === n.length, a = r > 0 && !i;
		return v`
      <div class="head" role="row" style="grid-template-columns: ${t}">
        ${this.selectable ? v`<button
              class="box ${i ? "on" : a ? "mixed" : ""}"
              role="checkbox"
              aria-checked=${i ? "true" : a ? "mixed" : "false"}
              aria-label="Select all loaded rows"
              data-testid="table-select-all"
              @click=${() => this._emit(i ? "clear-selection" : "select-all-loaded")}
            >
              ${i ? j("check", 13) : a ? j("minus", 13) : null}
            </button>` : null}
        <span role="columnheader">${this._sortHeader("name", "Name")}</span>
        ${e.map((e) => {
			let t = St.find((t) => t.key === e);
			return v`<span role="columnheader"
            >${t.sortField ? this._sortHeader(t.sortField, t.label) : t.label}</span
          >`;
		})}
        <span role="columnheader"></span>
      </div>

      <div
        class="body"
        role="rowgroup"
        data-testid="table-body"
        @scroll=${(e) => {
			let t = e.currentTarget;
			this._emit("near-end", { ratio: (t.scrollTop + t.clientHeight) / Math.max(1, t.scrollHeight) });
		}}
      >
        ${this.items.length ? Gn(this.items, (e) => e.id, (n) => v`
                <div
                  class="row ${this.selection.has(n.id) ? "selected" : ""}"
                  role="row"
                  tabindex="0"
                  data-testid="table-row"
                  data-item-id=${n.id}
                  style="grid-template-columns: ${t}"
                  @click=${() => this._emit(this.selectable ? "toggle-select" : "open-item", { itemId: n.id })}
                >
                  ${this.selectable ? v`<button
                        class="box ${this.selection.has(n.id) ? "on" : ""}"
                        role="checkbox"
                        aria-checked=${String(this.selection.has(n.id))}
                        aria-label=${`Select ${n.name}`}
                        data-testid="table-row-select"
                        @click=${(e) => {
			e.stopPropagation(), this._emit("toggle-select", { itemId: n.id });
		}}
                      >
                        ${this.selection.has(n.id) ? j("check", 13) : null}
                      </button>` : null}
                  <span class="name-cell">
                    <span class="name" data-testid="table-name" title=${n.name}>${n.name}</span>
                    ${Yn(n) ? v`<span class="low-badge">LOW</span>` : null}
                    ${n.checked_out ? v`<span class="out-chip">Checked out</span>` : null}
                  </span>
                  ${e.map((e) => this._cell(n, e))}
                  <span class="actions">
                    <button
                      data-testid="table-decrement"
                      aria-label="Decrease quantity"
                      ?disabled=${n.checked_out || n.quantity <= 0}
                      @click=${(e) => {
			e.stopPropagation(), this._emit("decrement", { itemId: n.id });
		}}
                    >
                      ${j("minus", 15)}
                    </button>
                    <button
                      data-testid="table-increment"
                      aria-label="Increase quantity"
                      ?disabled=${n.checked_out}
                      @click=${(e) => {
			e.stopPropagation(), this._emit("increment", { itemId: n.id });
		}}
                    >
                      ${j("plus", 15)}
                    </button>
                    <button
                      data-testid="table-edit"
                      aria-label=${`Edit ${n.name}`}
                      @click=${(e) => {
			e.stopPropagation(), this._emit("edit", { itemId: n.id });
		}}
                    >
                      ${j("pencil", 15)}
                    </button>
                  </span>
                </div>
              `) : v`<div class="empty" role="status" data-testid="table-empty">
              <slot name="empty">No items yet</slot>
            </div>`}
      </div>
    `;
	}
}, wr.styles = [
	O,
	k,
	o`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        min-width: 0;
        /* The column template has a hard minimum — 786px for the default set,
           826px with the selection column — and a grid whose tracks do not fit
           overflows its own box rather than shrinking. With overflow visible
           that spilled content was simply clipped by the shell: at 375px the
           rows measured clientWidth 634 against scrollWidth 854, and the Tags,
           Due and Updated columns could not be reached by any gesture. The
           table scrolls sideways instead, which keeps whichever columns the
           user chose rather than quietly dropping them on small screens. */
        overflow-x: auto;
        overscroll-behavior-x: contain;
      }
      /* Sizing the two boxes to the grid's own minimum is what makes the
         scroll work: left at the container's width they would stay 375px wide
         while their tracks painted past the edge, so the row dividers and
         hover backgrounds would stop short of the content. Both use the same
         template, so both land on the same width and stay aligned. */
      .head,
      .body {
        min-width: min-content;
      }
      .head,
      .row {
        display: grid;
        gap: 8px;
        align-items: center;
        padding: 10px 20px;
      }
      .head {
        padding: 7px 20px;
        border-bottom: 1px solid var(--hv-divider);
        font-size: 11.5px;
        font-weight: 500;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--hv-text-secondary);
        flex: none;
      }
      /* This reset must stay keyed to the sort buttons' own class. Written as
         .head button it also reaches the select-all box, which is a button in
         this header too, and at 0-1-1 it outranks .box's own 0-1-0 border and
         background — leaving the checkbox with nothing drawn at all until a
         selection exists. The border-color on .box.on cannot bring back a
         border-style of none, so the outline would never return. */
      .head button.sort {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        min-height: var(--hv-tap-min, auto);
        border: none;
        background: none;
        padding: 0;
        font: inherit;
        color: inherit;
        text-transform: inherit;
        letter-spacing: inherit;
      }
      .head button.sort.sorted {
        color: var(--hv-primary-dark);
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        /*
         * Contain the vertical overscroll — a flick that runs past the last row
         * must not scroll the dashboard behind this surface — but only the
         * vertical.
         *
         * The shorthand set both axes, and that is what stopped the sideways
         * scroll above from working at all. Declaring overflow on one axis
         * makes the other compute to auto, so this box is a horizontal scroll
         * container too; it is exactly as wide as its own content, so it has
         * nothing to scroll, and contain on that axis means a horizontal swipe
         * starting over a row is neither used nor handed on. The host measured
         * scrollWidth 874 against clientWidth 390 and stayed at scrollLeft 0
         * through the whole gesture, so the Tags, Due and Updated columns could
         * not be reached by any gesture — only by setting scrollLeft in script.
         */
        overscroll-behavior-y: contain;
      }
      .row {
        border-bottom: 1px solid var(--hv-row-divider);
        font-size: 13.5px;
        color: var(--hv-text);
      }
      .row:hover {
        background: var(--hv-row-hover);
      }
      .row.selected {
        background: var(--hv-row-hover);
      }
      .name-cell {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .name {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .low-badge {
        flex: none;
        font: 700 10.5px var(--hv-font);
        letter-spacing: 0.4px;
        color: var(--hv-warn);
        background: var(--hv-warn-bg);
        border-radius: 4px;
        padding: 2px 6px;
      }
      .out-chip {
        flex: none;
        font: 500 11px var(--hv-font);
        color: var(--hv-primary-darker);
        border: 1px solid var(--hv-primary-tint-border);
        border-radius: var(--hv-radius-chip);
        padding: 2px 8px;
      }
      .cell {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--hv-text-secondary);
      }
      .cell.qty {
        color: var(--hv-text);
      }
      .cell.qty.low {
        color: var(--hv-warn);
        font-weight: 500;
      }
      .cell.due.overdue {
        color: var(--hv-error);
        font-weight: 500;
      }
      /* Amber rather than the due column's red: a passed inspection date is a
         chore on an item still on the shelf, not an item that is late back. */
      .cell.inspection.due {
        color: var(--hv-warn);
        font-weight: 500;
      }
      .cell.updated {
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
      }
      .tags {
        display: flex;
        gap: 5px;
        overflow: hidden;
      }
      .tag {
        flex: none;
        font-size: 11px;
        color: var(--hv-chip-text);
        background: var(--hv-chip-bg);
        border-radius: var(--hv-radius-chip);
        padding: 2px 8px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 2px;
        visibility: hidden;
      }
      .row:hover .actions,
      .row:focus-within .actions {
        visibility: visible;
      }
      .actions button {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border: 1px solid var(--hv-divider);
        border-radius: 50%;
        background: none;
        color: var(--hv-text-secondary);
        padding: 0;
      }
      .actions button:hover:not([disabled]) {
        background: var(--hv-hover-overlay);
      }
      .actions button[disabled] {
        opacity: 0.35;
      }
      .box {
        display: inline-grid;
        place-items: center;
        position: relative;
        width: 16px;
        height: 16px;
        border-radius: 3px;
        border: 1.5px solid var(--hv-text-tertiary);
        background: none;
        color: #fff;
        padding: 0;
      }
      /* Grow the hit area for touch without growing the box, which has to stay
         checkbox-sized in a dense table. Clicking the row toggles the same
         selection, so on a row the two can only ever agree; the select-all in
         the header has nothing behind it and needs the area outright. */
      .box::after {
        content: '';
        position: absolute;
        inset: calc((var(--hv-tap-min, 16px) - 16px) / -2);
      }
      .box.on,
      .box.mixed {
        background: var(--hv-primary-dark);
        border-color: var(--hv-primary-dark);
      }
      .empty {
        padding: 32px 20px;
        text-align: center;
        color: var(--hv-text-secondary);
        font-size: 13px;
      }
    `
], wr);
N([E({ attribute: !1 })], Tr.prototype, "items", void 0), N([E({ attribute: !1 })], Tr.prototype, "columns", void 0), N([E({ attribute: !1 })], Tr.prototype, "sort", void 0), N([E({ type: Boolean })], Tr.prototype, "selectable", void 0), N([E({ attribute: !1 })], Tr.prototype, "selection", void 0), Tr = N([T("hv-data-table")], Tr);
//#endregion
//#region src/components/hv-full-view.ts
var Er, Dr = 200, Or = "(max-width: 700px)", Y = (Er = class extends b {
	constructor(...e) {
		super(...e), this.open = !1, this.heading = "Inventory", this.columns = [], this.menuEntries = [], this.startSelecting = !1, this._zBase = 0, this._filtersOpen = !1, this._searchDraft = "", this._editing = null, this._editorBusy = !1, this._creatingLocation = !1, this._locationError = null, this._sections = {
			locations: !0,
			categories: !0,
			tags: !0
		}, this._narrow = !1, this._stagedCount = null, this._selecting = !1, this._bulkProgress = null, this._bulkResult = null, this._pendingDelete = !1, this._loadingAll = !1, this._bulkCancelled = !1, this._lastOps = null, this._prevFocus = null, this._onNarrowChange = (e) => {
			this._narrow = e.matches;
		}, this._priceStaged = nn((e) => {
			this.store?.countMatching(e).then((e) => {
				this._stagedCount = e;
			});
		}, 150), this._close = () => {
			this.open = !1, this.dispatchEvent(new CustomEvent("close", {
				bubbles: !0,
				composed: !0
			}));
		}, this._emitSearch = nn((e) => this.store?.setFilters({ q: e }), Dr), this._onEditorSave = async (e) => {
			let t = e.detail;
			this._editorBusy = !0;
			let n = this.st?.errorQueue.length ?? 0;
			try {
				t.itemId && t.changes ? await this.store?.updateItem(t.itemId, t.changes, t.expectedVersion) : t.create && await this.store?.createItem(t.create);
			} finally {
				this._editorBusy = !1;
			}
			(this.st?.errorQueue.length ?? 0) === n && (this._editing = null);
		}, this._onBulkRun = (e) => {
			let t = e.detail;
			if (t.action === "delete") {
				this._pendingDelete = !0;
				return;
			}
			this._execute(this._opsFor(t, this._selectedItems));
		};
	}
	get st() {
		return this.store?.state.value ?? null;
	}
	connectedCallback() {
		super.connectedCallback(), this.store && !this._storeUnsub && (this._storeUnsub = this.store.state.onChange(() => this.requestUpdate())), this._narrowQuery ?? (this._narrowQuery = window.matchMedia?.(Or) ?? null), this._narrowQuery && (this._narrow = this._narrowQuery.matches, this._narrowQuery.addEventListener("change", this._onNarrowChange));
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._storeUnsub?.(), this._storeUnsub = void 0, this._narrowQuery?.removeEventListener("change", this._onNarrowChange);
	}
	willUpdate(e) {
		e.has("store") && this.store && (this._storeUnsub?.(), this._storeUnsub = this.store.state.onChange(() => this.requestUpdate())), e.has("open") && (this.open ? (this._zBase = M(), this._searchDraft = this.st?.filters.q ?? "", this._prevFocus = document.activeElement ?? null, this._selecting = this.startSelecting) : (this._filtersOpen = !1, this._editing = null, this._creatingLocation = !1, this._locationError = null, this._selecting = !1, this._bulkResult = null, this._bulkProgress = null));
	}
	updated(e) {
		e.has("open") && (this.open ? (this._focusFirst(), this._tree?.revealPathTo(this.st?.filters.locationId ?? null)) : this._prevFocus?.isConnected && this._prevFocus.focus());
	}
	get _tree() {
		return this.shadowRoot?.querySelector("hv-location-tree") ?? null;
	}
	_focusables() {
		let e = this.shadowRoot?.querySelector(".shell");
		return e ? [...e.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])")].filter((e) => !e.hasAttribute("disabled") && !e.classList.contains("sentinel")) : [];
	}
	_focusFirst() {
		this._focusables()[0]?.focus();
	}
	_focusLast() {
		let e = this._focusables();
		e[e.length - 1]?.focus();
	}
	_setFilters(e) {
		this.store?.setFilters(e);
	}
	_onRowEvent(e, t) {
		let n = this.st?.items.find((e) => e.id === t.itemId);
		if (n) switch (e) {
			case "increment":
				this.store?.adjustQuantity(n.id, 1);
				break;
			case "decrement":
				n.quantity > 0 && this.store?.adjustQuantity(n.id, -1);
				break;
			case "edit":
			case "open-item":
				this._editing = n.id;
				break;
		}
	}
	get _selectedItems() {
		let e = this.st?.selection ?? /* @__PURE__ */ new Set();
		return (this.st?.items ?? []).filter((t) => e.has(t.id));
	}
	_exitSelection() {
		this._selecting = !1, this._bulkResult = null, this._lastOps = null, this.store?.clearSelection();
	}
	_opsFor(e, t) {
		switch (e.action) {
			case "move": return {
				label: "Move",
				ops: t.map((t) => C("item_move", {
					item_id: t.id,
					location_id: e.locationId ?? null,
					expected_version: t.version
				}))
			};
			case "add-tags": return {
				label: "Tagging",
				ops: t.map((t) => C("item_add_tags", {
					item_id: t.id,
					tags: e.tags ?? []
				}))
			};
			case "remove-tags": return {
				label: "Untagging",
				ops: t.map((t) => C("item_remove_tags", {
					item_id: t.id,
					tags: e.tags ?? []
				}))
			};
			case "set-category": return {
				label: "Categorising",
				ops: t.map((t) => C("item_update", {
					item_id: t.id,
					category: e.category ?? null,
					expected_version: t.version
				}))
			};
			case "adjust-qty": return {
				label: "Adjusting",
				ops: t.map((t) => C("item_adjust_quantity", {
					item_id: t.id,
					delta: e.delta ?? 0
				}))
			};
			case "check-out": return {
				label: "Checking out",
				ops: t.map((t) => C("item_check_out", {
					item_id: t.id,
					due_date: e.dueDate ?? null
				}))
			};
			case "check-in": return {
				label: "Checking in",
				ops: t.map((e) => C("item_check_in", { item_id: e.id }))
			};
			case "delete": return {
				label: "Delete",
				ops: t.map((e) => C("item_delete", {
					item_id: e.id,
					expected_version: e.version
				}))
			};
		}
	}
	async _execute(e) {
		if (!e.ops.length) return;
		this._lastOps = e, this._bulkCancelled = !1, this._bulkResult = null, this._bulkProgress = {
			done: 0,
			total: e.ops.length,
			failed: 0,
			label: e.label
		};
		let t = 0, n = await this.store?.bulkExecute(e.ops, {
			onProgress: (n, r, i) => {
				t = n, this._bulkProgress = {
					done: n,
					total: r,
					failed: i,
					label: e.label
				};
			},
			isCancelled: () => this._bulkCancelled
		});
		this._bulkProgress = null, n && (this._bulkResult = {
			label: e.label,
			succeeded: Math.max(0, t - n.failed.length),
			failed: n.failed
		}, this.store?.setSelected(n.failed.map((e) => e.itemId).filter((e) => !!e)));
	}
	async _createLocation(e) {
		let t = e.trim();
		if (t) {
			this._locationError = null;
			try {
				await this.store?.createLocation(t, this.st?.filters.locationId ?? null, null), this._creatingLocation = !1;
			} catch (e) {
				this._locationError = e?.message ?? "Could not create that location.";
			}
		}
	}
	_renderSectionToggle(e, t) {
		let n = this._sections[e];
		return v`<button
      class="section-toggle"
      data-testid=${`sidebar-toggle-${e}`}
      aria-expanded=${String(n)}
      @click=${() => {
			this._sections = {
				...this._sections,
				[e]: !n
			};
		}}
    >
      ${j(n ? "chevronDown" : "chevronRight", 18)}
      <span class="hv-label">${t}</span>
    </button>`;
	}
	_renderTagsMode(e) {
		return v`<span class="segmented" role="radiogroup" aria-label="Tag match mode">
      ${["any", "all"].map((t) => v`<button
          class=${e === t ? "on" : ""}
          role="radio"
          aria-checked=${String(e === t)}
          data-testid="sidebar-tags-mode"
          data-mode=${t}
          title=${t === "any" ? "Items with any of the selected tags" : "Items with all of them"}
          @click=${() => this._setFilters({ tagsMode: t })}
        >
          ${t === "any" ? "Any" : "All"}
        </button>`)}
    </span>`;
	}
	_renderFacetSection(e, t, n, r, i, a) {
		let o = this._sections[e];
		return v`
      <div class="sidebar-head">
        ${this._renderSectionToggle(e, t)}
        ${a ?? null}
        <span class="section-tally" data-testid=${`sidebar-${e}-tally`}>${n.length}</span>
        <span class="head-action">
          <!-- Locations could be added to from here and the other two could not,
               so the one heading with a "+" was also the only facet you could
               create without hunting for the organize dialog. A category or tag
               exists through the items using it — there is nothing to create on
               the server — so this opens Organize on the matching tab, where
               that is explained, rather than inventing a second place to do it.
               The ellipsis is the card's usual mark for "opens elsewhere". -->
          <button
            class="hv-icon-button"
            data-testid=${`sidebar-new-${e}`}
            aria-label=${`New ${e === "tags" ? "tag" : "category"}…`}
            title=${`New ${e === "tags" ? "tag" : "category"}…`}
            @click=${() => this.dispatchEvent(new CustomEvent("menu-action", {
			detail: {
				id: "organize",
				tab: e
			},
			bubbles: !0,
			composed: !0
		}))}
          >
            ${j("plus", 20)}
          </button>
        </span>
      </div>
      ${o ? n.length ? n.map((t) => v`<button
                class="value-row ${r(t.value) ? "on" : ""}"
                data-testid=${`sidebar-${e}-row`}
                data-value=${t.value}
                aria-pressed=${String(r(t.value))}
                @click=${() => i(t.value)}
              >
                ${r(t.value) ? j("check", 15) : null}
                <!-- These clip with an ellipsis, and a clipped value the user
                     typed is otherwise unreadable — there is nowhere else in
                     the sidebar it appears in full. -->
                <span class="label" title=${t.value}>${t.value}</span>
                <span class="tally">${t.count}</span>
              </button>`) : v`<div class="section-empty" data-testid=${`sidebar-${e}-empty`}>
              ${e === "tags" ? "No tags in use yet" : "No categories in use yet"}
            </div>` : null}
    `;
	}
	_renderSidebar() {
		let e = this.st, t = e?.filters ?? x(), n = e?.distinctValuesCache, r = new Set(t.tags);
		return v`
      <div class="sidebar" data-testid="full-sidebar">
        <div class="sidebar-head">
          ${this._renderSectionToggle("locations", "Locations")}
          <!-- Categories and tags each state how many there are; locations
               offered a "+" and no number, so the one section you can add to was
               also the one you could not size up. -->
          <span class="section-tally" data-testid="sidebar-locations-tally">
            ${nt(e?.locationTreeCache ?? [])}
          </span>
          <span class="head-action">
            <button
              class="hv-icon-button"
              data-testid="sidebar-new-location"
              aria-label="New location"
              title="New location"
              @click=${() => {
			this._creatingLocation = !this._creatingLocation, this._locationError = null, this._creatingLocation && (this._sections = {
				...this._sections,
				locations: !0
			});
		}}
            >
              ${j("plus", 20)}
            </button>
          </span>
        </div>
        ${this._sections.locations ? this._renderLocationSection() : null}
        ${this._renderFacetSection("categories", "Categories", n?.categories ?? [], (e) => t.category === e, (e) => this._setFilters({ category: t.category === e ? null : e }))}
        ${this._renderFacetSection("tags", "Tags", n?.tags ?? [], (e) => r.has(e), (e) => this._setFilters({ tags: r.has(e) ? t.tags.filter((t) => t !== e) : [...t.tags, e] }), t.tags.length > 1 ? this._renderTagsMode(t.tagsMode) : null)}
      </div>
    `;
	}
	_renderLocationSection() {
		let e = this.st, t = e?.filters ?? x();
		return v`
        ${this._creatingLocation ? v`<div class="new-location">
              <input
                data-testid="sidebar-new-location-name"
                placeholder="New location name"
                aria-label="New location name"
                @keydown=${(e) => {
			e.key === "Enter" && this._createLocation(e.target.value), e.key === "Escape" && (this._creatingLocation = !1);
		}}
              />
              <button
                class="hv-pill"
                data-testid="sidebar-new-location-save"
                @click=${() => {
			let e = this.shadowRoot?.querySelector("[data-testid=\"sidebar-new-location-name\"]");
			this._createLocation(e?.value ?? "");
		}}
              >
                Add
              </button>
            </div>` : null}
        ${this._locationError ? v`<div class="inline-error" role="alert" data-testid="sidebar-location-error">
              ${this._locationError}
            </div>` : null}
        <hv-location-tree
          data-testid="sidebar-tree"
          .nodes=${e?.locationTreeCache ?? []}
          .selectedId=${t.locationId}
          .orphansSelected=${t.orphansOnly}
          .areas=${e?.areasCache?.areas ?? []}
          showAll
          showOrphans
          showCounts
          .totalCount=${e?.statsCounts?.items_total ?? null}
          .orphanCount=${e?.statsCounts?.no_location_count ?? null}
          .matchingTotalCount=${e?.locationMatchTotal ?? null}
          @select=${(e) => this._setFilters({
			locationId: e.detail.locationId,
			orphansOnly: !1
		})}
          @select-orphans=${() => this._setFilters({
			locationId: null,
			orphansOnly: !0
		})}
        ></hv-location-tree>
    `;
	}
	_renderPanelFoot() {
		let e = () => this.renderRoot?.querySelector("[data-testid=\"full-filter-panel\"]");
		return v`<div class="panel-foot" data-testid="full-panel-foot">
      <button class="hv-text-button" data-testid="full-panel-clear" @click=${() => e()?.clearAll()}>
        Clear all
      </button>
      <span class="spacer"></span>
      <button
        class="hv-text-button"
        data-testid="full-panel-cancel"
        @click=${() => {
			e()?.resetDraft(), this._filtersOpen = !1;
		}}
      >
        Cancel
      </button>
      <button class="hv-pill" data-testid="full-panel-apply" @click=${() => e()?.apply()}>
        ${this._stagedCount === null ? "Show items" : `Show ${P(this._stagedCount, "item")}`}
      </button>
    </div>`;
	}
	_renderEmpty() {
		let e = this.st, t = e?.filters ?? x();
		return on(rn(this.st), {
			locationName: (e?.locationsFlatCache ?? []).find((e) => e.id === t.locationId)?.name ?? null,
			onAction: (e) => {
				e === "clear-filters" ? this.store?.clearFilters() : e === "add-item" ? this._editing = "new" : e === "refresh" ? this.store?.refreshAll() : this.dispatchEvent(new CustomEvent("menu-action", {
					detail: { id: e },
					bubbles: !0,
					composed: !0
				}));
			}
		});
	}
	_renderContextBar() {
		let e = this.st, t = e?.filters ?? x(), n = (e?.locationsFlatCache ?? []).find((e) => e.id === t.locationId), r = n ? (n.path?.display_path ?? n.name).split("/").map((e) => e.trim()) : [], i = S(t);
		return v`
      <div class="context">
        <span class="crumb" data-testid="full-breadcrumb">
          ${t.orphansOnly ? v`<span class="current">No location</span>` : r.length ? r.map((e, t) => t === r.length - 1 ? v`<span class="current">${e}</span>` : v`<span>${e} › </span>`) : v`<span class="current">All items</span>`}
          ${e?.total !== null && e?.total !== void 0 ? v` · ${P(e.total, "item")}` : null}
        </span>
        <span class="spacer"></span>
        ${i > 0 ? v`<hv-filter-chips
              .filters=${t}
              .locations=${e?.locationsFlatCache ?? null}
              .areas=${e?.areasCache?.areas ?? []}
              @remove-filter=${(e) => this._setFilters(e.detail.patch)}
              @clear-filters=${() => this.store?.clearFilters()}
            ></hv-filter-chips>` : null}
        <button
          class="filters-button ${this._filtersOpen ? "on" : ""}"
          data-testid="full-filters-toggle"
          aria-expanded=${String(this._filtersOpen)}
          @click=${() => {
			this._filtersOpen = !this._filtersOpen, this._filtersOpen && this._narrow && this._priceStaged(t);
		}}
        >
          ${j("tune", 16)}Filters
        </button>
        <button
          class="hv-icon-button"
          data-testid="columns-expanded"
          aria-label="Choose columns"
          title="Choose columns"
          @click=${() => this.dispatchEvent(new CustomEvent("menu-action", {
			detail: { id: "columns" },
			bubbles: !0,
			composed: !0
		}))}
        >
          ${j("viewColumn", 20)}
        </button>
      </div>
    `;
	}
	render() {
		if (!this.open) return null;
		let e = this._zBase || 9998;
		return v`
      <div class="backdrop" role="presentation" style="z-index: ${e};" @click=${this._close}></div>
      <div
        class="shell"
        role="dialog"
        aria-modal="true"
        aria-label=${this.heading}
        data-testid="full-view"
        style="z-index: ${e + 1};"
        @keydown=${A(() => this._close())}
      >
        <span class="sentinel" tabindex="0" @focus=${() => this._focusLast()}></span>
        ${this._selecting ? this._renderSelectionBar() : this._renderAppBar()}
        ${this._renderBody()}
        <span class="sentinel" tabindex="0" @focus=${() => this._focusFirst()}></span>
      </div>
    `;
	}
	_renderSelectionBar() {
		let e = this.st, t = e?.selection.size ?? 0, n = e?.total ?? null, r = e?.items.length ?? 0, i = n !== null && r < n;
		return v`
      <div class="appbar selecting" data-testid="selection-bar">
        <button class="tap" data-testid="exit-selection" aria-label="Exit selection" @click=${() => this._exitSelection()}>
          ${j("close", 20)}
        </button>
        <span class="count" data-testid="selection-count">${t} selected</span>
        ${n === null ? null : v`<span class="subcount" data-testid="selection-subcount"
              >of ${n} matching the current filter</span
            >`}
        ${i ? v`<button
              class="ghost load-all"
              data-testid="selection-load-all"
              ?disabled=${this._loadingAll}
              @click=${async () => {
			this._loadingAll = !0;
			try {
				await this.store?.loadAllThenSelectAll();
			} finally {
				this._loadingAll = !1;
			}
		}}
            >
              ${this._loadingAll ? "Loading…" : `Load all ${n} to select`}
            </button>` : null}
        <span class="spacer"></span>
        <button class="ghost plain" data-testid="selection-clear" @click=${() => this.store?.clearSelection()}>
          Clear selection
        </button>
      </div>
    `;
	}
	_renderAppBar() {
		let e = this.st, t = e?.filters ?? x(), n = e?.statsCounts;
		return v`
        <div class="appbar">
          <button class="tap" data-testid="expand-toggle" aria-label="Close full view" @click=${this._close}>
            ${j("close", 20)}
          </button>
          <h2>${this.heading}</h2>
          <label class="search">
            ${j("magnify", 18)}
            <span class="hv-sr-only">Search items</span>
            <input
              type="search"
              data-testid="full-search"
              placeholder=${n ? `Search all ${P(n.items_total, "item")}…` : "Search items…"}
              .value=${this._searchDraft}
              @input=${(e) => {
			this._searchDraft = e.target.value, this._emitSearch(this._searchDraft);
		}}
            />
          </label>
          <span class="spacer"></span>
          ${n && n.low_stock_count > 0 ? v`<button
                class="pill low ${t.lowStockOnly ? "on" : ""}"
                data-testid="full-badge-low"
                aria-pressed=${String(t.lowStockOnly)}
                title="Show only low-stock items"
                @click=${() => this._setFilters({ lowStockOnly: !t.lowStockOnly })}
              >
                ${n.low_stock_count} low
              </button>` : null}
          ${n && (n.overdue_count ?? 0) > 0 ? v`<button
                class="pill overdue ${t.overdueOnly ? "on" : ""}"
                data-testid="full-badge-overdue"
                aria-pressed=${String(t.overdueOnly)}
                title="Show only overdue items"
                @click=${() => this._setFilters({ overdueOnly: !t.overdueOnly })}
              >
                ${n.overdue_count} overdue
              </button>` : null}
          ${n && (n.inspection_overdue_count ?? 0) > 0 ? v`<button
                class="pill inspect ${t.inspectionDueOnly ? "on" : ""}"
                data-testid="full-badge-inspection"
                aria-pressed=${String(t.inspectionDueOnly)}
                title="Show only items due for inspection"
                @click=${() => this._setFilters({ inspectionDueOnly: !t.inspectionDueOnly })}
              >
                ${n.inspection_overdue_count} to inspect
              </button>` : null}
          ${n && n.checked_out_count > 0 ? v`<button
                class="pill out ${t.checkedOutOnly ? "on" : ""}"
                data-testid="full-badge-out"
                aria-pressed=${String(t.checkedOutOnly)}
                title="Show only checked-out items"
                @click=${() => this._setFilters({ checkedOutOnly: !t.checkedOutOnly })}
              >
                ${n.checked_out_count} checked out
              </button>` : null}
          <button
            class="add"
            data-testid="full-add-item"
            @click=${() => {
			this._editing = "new";
		}}
          >
            ${j("plus", 16)}Add item
          </button>
          <hv-overflow-menu
            onPrimary
            data-testid="full-overflow"
            .entries=${this.menuEntries}
            @select=${(e) => {
			if (e.detail.id === "select-items") {
				this._selecting = !0;
				return;
			}
			this.dispatchEvent(new CustomEvent("menu-action", {
				detail: e.detail,
				bubbles: !0,
				composed: !0
			}));
		}}
          ></hv-overflow-menu>
        </div>
    `;
	}
	_renderBody() {
		let e = this.st, t = e?.filters ?? x(), n = e?.statsCounts, r = e?.items.length ?? 0, i = e?.selection ?? /* @__PURE__ */ new Set();
		return v`
        <div class="body">
          ${this._renderSidebar()}
          <div class="main">
            ${this._renderContextBar()}
            ${this._filtersOpen ? v`<div class="panel-holder">
                  <div class="panel-scroll">
                  <hv-filter-panel
                    data-testid="full-filter-panel"
                    .filters=${t}
                    .distinct=${e?.distinctValuesCache ?? null}
                    .areas=${e?.areasCache?.areas ?? []}
                    .locations=${e?.locationsFlatCache ?? null}
                    .locationTree=${e?.locationTreeCache ?? []}
                    .total=${e?.total ?? null}
                    .grandTotal=${n?.items_total ?? null}
                    .counts=${n ?? null}
                    ?mobile=${this._narrow}
                    @change=${(e) => this._setFilters(e.detail)}
                    @stage=${(e) => this._priceStaged(e.detail.filters)}
                    @apply=${(e) => {
			this._setFilters(e.detail), this._filtersOpen = !1;
		}}
                    @clear-filters=${() => this.store?.clearFilters()}
                  ></hv-filter-panel>
                  </div>
                  ${this._narrow ? this._renderPanelFoot() : null}
                </div>` : null}
            ${this._editing === null ? null : v`<div class="editor-holder">
                  <hv-item-editor
                    data-testid="full-editor"
                    .item=${this._editing === "new" ? null : e?.items.find((e) => e.id === this._editing) ?? null}
                    .locations=${e?.locationsFlatCache ?? null}
                    .locationTree=${e?.locationTreeCache ?? []}
                    .categorySuggestions=${(e?.distinctValuesCache?.categories ?? []).map((e) => e.value)}
                    .tagSuggestions=${(e?.distinctValuesCache?.tags ?? []).map((e) => e.value)}
                    .customFieldKeys=${e?.distinctValuesCache?.custom_field_keys ?? []}
                    .busy=${this._editorBusy}
                    ?mobile=${this._narrow}
                    @save=${this._onEditorSave}
                    @cancel=${() => {
			this._editing = null;
		}}
                    @delete-item=${(e) => this.dispatchEvent(new CustomEvent("request-delete", {
			detail: e.detail,
			bubbles: !0,
			composed: !0
		}))}
                  ></hv-item-editor>
                </div>`}

            ${this._selecting && e?.total !== null && e?.total !== void 0 && r < e.total ? v`<div class="honesty" data-testid="selection-honesty">
                  ${r} of ${e.total} loaded · scroll to load more. Select-all covers loaded rows only.
                </div>` : null}

            <hv-data-table
              data-testid="full-table"
              .items=${e?.items ?? []}
              .columns=${this.columns}
              .sort=${t.sort}
              ?selectable=${this._selecting}
              .selection=${i}
              @sort-change=${(e) => this._setFilters({ sort: e.detail.sort })}
              @near-end=${(e) => void this.store?.prefetchIfNeeded(e.detail.ratio)}
              @increment=${(e) => this._onRowEvent("increment", e.detail)}
              @decrement=${(e) => this._onRowEvent("decrement", e.detail)}
              @edit=${(e) => this._onRowEvent("edit", e.detail)}
              @open-item=${(e) => this._onRowEvent("open-item", e.detail)}
              @toggle-select=${(e) => this.store?.toggleSelected(e.detail.itemId)}
              @select-all-loaded=${() => this.store?.selectAllLoaded()}
              @clear-selection=${() => this.store?.clearSelection()}
            >
              <div slot="empty">${this._renderEmpty()}</div>
            </hv-data-table>

            ${this._selecting ? v`<hv-bulk-bar
                  data-testid="full-bulk-bar"
                  .selectedCount=${i.size}
                  .selectedItems=${this._selectedItems}
                  .locationTree=${e?.locationTreeCache ?? []}
                  .distinct=${e?.distinctValuesCache ?? null}
                  .progress=${this._bulkProgress}
                  .result=${this._bulkResult}
                  @run=${this._onBulkRun}
                  @cancel-run=${() => {
			this._bulkCancelled = !0;
		}}
                  @dismiss-result=${() => {
			this._bulkResult = null;
		}}
                  @retry-failed=${() => {
			let e = this._bulkResult?.failed ?? [];
			!this._lastOps || !e.length || this._execute({
				label: this._lastOps.label,
				ops: e.map((e) => C(e.op.kind, { ...e.op.payload }))
			});
		}}
                ></hv-bulk-bar>` : null}

            <div class="footer" data-testid="full-footer">
              ${e?.total !== null && e?.total !== void 0 ? `Showing ${r} of ${e.total}${e.cursor ? " · scroll to load more" : ""}` : `Showing ${r}`}
            </div>
          </div>
        </div>

        <hv-confirm
          data-testid="bulk-confirm"
          ?open=${this._pendingDelete}
          .heading=${`Delete ${P(i.size, "item")}?`}
          message="This cannot be undone. Items are removed for every connected client. Locations and tags are not affected."
          .warning=${this._checkedOutWarning}
          .confirmLabel=${`Delete ${i.size}`}
          destructive
          @confirm=${() => {
			this._pendingDelete = !1, this._execute(this._opsFor({ action: "delete" }, this._selectedItems));
		}}
          @cancel=${() => {
			this._pendingDelete = !1;
		}}
        ></hv-confirm>
    `;
	}
	get _checkedOutWarning() {
		let e = this._selectedItems.filter((e) => e.checked_out).length;
		return e ? `${e} of them ${en(e, "is", "are")} checked out` : null;
	}
}, Er.styles = [
	O,
	k,
	o`
      :host {
        display: contents;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
      }
      .shell {
        position: fixed;
        inset: 0;
        display: grid;
        grid-template-rows: auto 1fr;
        background: var(--hv-surface);
        color: var(--hv-text);
        /* The app bar does not compress below 778px — close, the title, the
           search box's own minimum, three count pills, Add item and the ⋮ —
           and the grid column takes that minimum whatever the screen is. On a
           phone held sideways, 760px, the surface was therefore 18px wider
           than the viewport, and with overflow hidden those 18px did not
           exist: the ⋮ was sliced down the middle, the editor's Save sat flush
           against the screen edge, and no gesture could bring either back.

           Vertical stays clipped — this surface *is* the viewport and the
           boxes inside it do their own scrolling — but when the layout
           genuinely does not fit sideways it can now be panned to. */
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior: contain;
        box-shadow: var(--hv-shadow-overlay);
      }
      .appbar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        background: var(--hv-primary);
        color: #fff;
      }
      .appbar.selecting {
        background: var(--hv-primary-darker);
      }
      .appbar .count {
        font: 500 18px var(--hv-font);
      }
      .appbar .subcount {
        font-size: 12.5px;
        opacity: 0.85;
      }
      .appbar .ghost {
        flex: none;
        border: 1px solid rgba(255, 255, 255, 0.45);
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
        border-radius: var(--hv-radius-chip);
        padding: 5px 13px;
        font: 500 12.5px var(--hv-font);
      }
      .appbar .ghost.plain {
        background: none;
        font-weight: 400;
      }
      .honesty {
        padding: 10px 20px;
        border-bottom: 1px solid var(--hv-row-divider);
        font-size: 12px;
        color: var(--hv-text-tertiary);
      }
      .appbar h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 500;
        white-space: nowrap;
      }
      .appbar .tap {
        width: var(--hv-tap-min, 36px);
        height: var(--hv-tap-min, 36px);
        border: none;
        border-radius: 50%;
        background: none;
        color: #fff;
        display: inline-grid;
        place-items: center;
        padding: 0;
        flex: none;
      }
      .appbar .tap:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .appbar .search {
        flex: 1;
        /* Without this the field will not shrink below its content width, and
           a flex item that refuses to shrink pushes everything after it off
           the end of a narrow bar. */
        min-width: 0;
        /* A flex-basis is a content-box width by default, so the full-width
           basis it takes on a phone came out 24px wider than the line — its own
           padding — and the bar overflowed its right edge by that much. */
        box-sizing: border-box;
        max-width: 420px;
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.22);
        border-radius: var(--hv-radius-chip);
        padding: 7px 14px;
      }
      .appbar .search input {
        flex: 1;
        min-width: 0;
        border: none;
        background: none;
        outline: none;
        color: #fff;
        font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
      }
      .appbar .search input::placeholder {
        color: rgba(255, 255, 255, 0.8);
      }
      .appbar .pill {
        flex: none;
        border: none;
        border-radius: var(--hv-radius-chip);
        background: rgba(255, 255, 255, 0.22);
        color: #fff;
        padding: 4px 11px;
        font: 500 11.5px var(--hv-font);
      }
      .appbar .pill.on {
        outline: 2px solid #fff;
      }
      /*
       * Low and overdue carry the card's meanings here too: amber for a stock
       * warning, red for a passed due date. Two identical translucent pills
       * reading "102 low" and "82 out" told you nothing apart.
       *
       * They cannot reuse the card's exact fills, though. Those are pale tints
       * of their hue chosen to sit on a plain card surface, and in dark mode
       * they are translucent — laid over this already-blue bar, "low" would come
       * out as faintly warm blue with amber text on it. Same hues, same
       * meanings, solid fills that do not depend on what is behind them.
       * Checked out keeps the neutral wash, which is what the card's
       * primary-tint amounts to on a primary-coloured bar.
       */
      .appbar .pill.low {
        background: var(--hv-amber);
        color: #3b2600;
      }
      .appbar .pill.overdue {
        background: var(--hv-error);
        color: #fff;
      }
      /* Amber like low stock, not red like overdue: red is reserved here for an
         item that is out and late back, while an inspection that has come due
         is a chore on something still on the shelf. */
      .appbar .pill.inspect {
        background: var(--hv-amber);
        color: #3b2600;
      }
      .appbar .add {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: none;
        border-radius: var(--hv-radius-chip);
        background: #fff;
        color: var(--hv-primary-darker);
        padding: 7px 15px;
        font: 500 13px var(--hv-font);
      }
      .spacer {
        margin-left: auto;
      }
      .body {
        display: grid;
        grid-template-columns: 264px 1fr;
        min-height: 0;
      }
      /* Now reachable from a narrow card, so it can land on a phone-width
         viewport: there is no room for a 264px tree beside the table, and the
         app bar's search and filters still cover navigation.

         This surface is fixed to the viewport rather than sized by the card,
         so a media query — not the card's measured-width mobile flag — is the
         right signal here. */
      @media (max-width: 700px) {
        .body {
          grid-template-columns: 1fr;
        }
        .sidebar {
          display: none;
        }
        /* The full view is reachable from a phone, and nothing in the app bar
           could give: every child is flex:none, the heading is nowrap, and
           .search had flex:1 but no min-width:0 so it would not compress below
           its content. At 375px the bar laid out to 634px inside a 375px page
           with no horizontal scroll, which put Add item (532..636), the badges
           and the ⋮ (648..682) permanently off-screen — you could not add an
           item or open the menu at all. */
        /* This surface fills the screen even when the card that opened it is
           narrow, so it sets its own touch sizing rather than inheriting the
           card's. Declared on the shell so the table, its sort headers and the
           context bar are covered too, not just the app bar. */
        .shell {
          --hv-tap-min: 44px;
          --hv-input-font: 16px;
        }
        .appbar {
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 12px;
        }
        /* The bar reads at the size of the list it sits over: 13.5px is the
           table row (hv-data-table .row), and matching it is what stops a
           three-row bar from looking like the loudest thing on the screen.
           This is the one control that opts out of the shell's 16px input
           size above — the size iOS wants to avoid zooming a focused field —
           because it is a filter box in a bar, not a form field. */
        .appbar .search input {
          font-size: 13.5px;
          min-height: 34px;
        }
        .filters-button {
          min-height: var(--hv-tap-min, auto);
        }
        .appbar h2 {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 17px;
        }
        /* Second row: the search alone. A 200px basis let the first count pill
           ride up beside it, which split the three pills across two rows and
           read as if that one belonged to the search box. A full-width basis
           gives the search the line and keeps the pills together under it. */
        .appbar .search {
          order: 1;
          flex: 1 0 100%;
          max-width: none;
          padding: 5px 12px;
        }
        /* Third row. These are secondary toggles reporting a count, not the
           bar's actions, so they keep their own compact height instead of
           growing to the 44px tap target the buttons above them take. */
        .appbar .pill {
          order: 2;
          min-height: 30px;
          padding: 5px 11px;
        }
        .appbar .ghost,
        .appbar .add {
          min-height: var(--hv-tap-min, auto);
        }
        .appbar .add {
          padding: 0 14px;
        }
        /* An auto margin cannot push anything anywhere once the row wraps, and
           it would only add a phantom flex item to the line. */
        .appbar .spacer {
          display: none;
        }

        /* Selection mode reuses this bar and broke in its own way. .subcount
           was the only shrinkable item in a row of flex:none siblings, so it
           collapsed to its longest word and stacked "of 556 / matching / the /
           current / filter" down five lines, eating ~230px of a 667px screen —
           and Clear selection landed at 380..490, off the side. Giving the
           count the slack keeps Clear on the first row, and the subtitle gets
           a line to itself instead of a column. */
        .appbar.selecting .count {
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .appbar.selecting .subcount {
          order: 1;
          flex-basis: 100%;
        }
        .appbar.selecting .load-all {
          order: 2;
        }
      }
      .sidebar {
        background: var(--hv-page);
        border-right: 1px solid var(--hv-divider);
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-bottom: 16px;
      }
      .sidebar-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 14px 16px 6px;
      }
      /* The heading is the collapse control, so it is a button — which is why
         the "+ new location" action stays a sibling rather than a child of it. */
      .section-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        /* Not flex:1: the tags heading puts its Any/All control immediately
           after the word it qualifies, and a stretching heading would shove it
           across to the tally. The tally right-aligns by margin instead. */
        flex: 0 1 auto;
        min-width: 0;
        min-height: var(--hv-tap-min, auto);
        border: none;
        background: none;
        padding: 0;
        margin-left: -4px;
        color: var(--hv-text-secondary);
        text-align: left;
      }
      .section-toggle:hover {
        color: var(--hv-text);
      }
      .section-toggle .hv-label {
        color: inherit;
      }
      .section-tally {
        flex: none;
        margin-left: auto;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      /* The filter panel's Any/All control, in the sidebar that also selects
         tags. Same rules, different shadow root. */
      .segmented {
        display: inline-flex;
        flex: none;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-chip);
        overflow: hidden;
      }
      .segmented button {
        border: none;
        background: none;
        color: var(--hv-chip-text);
        /* 2px of padding measured 17px tall, which is a poor target even for a
           mouse; there is room for this in a 264px column. */
        padding: 4px 10px;
        font: 400 11.5px var(--hv-font);
        min-height: var(--hv-tap-min, auto);
      }
      .segmented button.on {
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        font-weight: 500;
      }
      /* The three tallies read as one column, so a heading with no trailing
         action still reserves the room one takes — otherwise the Locations
         count sits an icon-button's width left of the other two. */
      .head-action {
        flex: none;
        display: flex;
        justify-content: flex-end;
        width: var(--hv-tap-min, 34px);
      }
      /*
       * A category or tag row. Deliberately the same shape as a location row in
       * hv-location-tree — it is the same act, filtering the table down to one
       * facet — but that tree is another shadow root, so the rule cannot be
       * shared. Indented to where the tree's names start, past its twisty.
       */
      .value-row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        box-sizing: border-box;
        min-height: var(--hv-tap-min, auto);
        border: none;
        background: none;
        text-align: left;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
        padding: 7px 12px 7px 34px;
        border-radius: var(--hv-radius-input);
      }
      .value-row:hover {
        background: var(--hv-hover-overlay);
      }
      .value-row.on {
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
        font-weight: 500;
        box-shadow: inset -3px 0 0 0 var(--hv-primary);
      }
      .value-row .label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .value-row .tally {
        flex: none;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      .value-row.on .tally {
        color: inherit;
      }
      .section-empty {
        padding: 2px 16px 8px 34px;
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
      }
      .main {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
      }
      .context {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 20px;
        flex-wrap: wrap;
      }
      .crumb {
        font-size: 13px;
        color: var(--hv-text-secondary);
        min-width: 0;
      }
      .crumb .current {
        font-weight: 500;
        color: var(--hv-text);
      }
      .filters-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--hv-divider);
        background: none;
        color: var(--hv-text-secondary);
        border-radius: var(--hv-radius-chip);
        padding: 6px 13px;
        font: 500 12.5px var(--hv-font);
      }
      .filters-button.on {
        border-color: var(--hv-primary);
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
      }
      /* The empty state is slotted into the table, so it stays in this tree and
         is styled here — the same block the card's list draws, since the words
         and the offers now come from one place. */
      .empty {
        display: grid;
        justify-items: center;
        gap: 10px;
        padding: 12px 16px 24px;
        text-align: center;
        color: var(--hv-text-secondary);
        font-size: 13px;
      }
      .empty .headline {
        font-size: 14px;
        font-weight: 500;
        color: var(--hv-text);
      }
      .empty .offers {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
      }
      /*
       * Every filter the backend accepts, stacked in one column, is around
       * 1600px of form. Nothing in this column was a scroll container and the
       * shell is fixed to the viewport and clips, so on a 756px screen 1138px
       * of the panel simply did not exist: the sort controls, the date rows
       * and the Show N items button sat about a thousand pixels below the
       * bottom edge, reachable by no gesture at all, and the table under it
       * was squeezed to zero.
       *
       * Same shape as the editor holder below — a ceiling with a scroll box
       * inside it — except the foot stays pinned, because the panel's whole
       * point is the count on that button.
       *
       * The second term of the min() measures the column rather than the
       * viewport, so the context bar above the panel and the footer below it
       * keep their room at any screen height. A width-only breakpoint would
       * leave both a 760x400 landscape phone and a 1280x900 desktop with no
       * effective ceiling at all.
       */
      .panel-holder {
        padding: 0 20px 12px;
        display: flex;
        flex-direction: column;
        flex: none;
        min-height: 0;
        /* The ceiling is a content-box measurement by default, so the 12px of
           padding below the panel was added back on top of it and the footer
           hung 5px off the bottom of a landscape screen. */
        box-sizing: border-box;
        max-height: min(80dvh, calc(100% - 116px));
      }
      .panel-scroll {
        flex: 1;
        min-width: 0;
        min-height: 0;
        overflow-y: auto;
        /* Stop a flick that runs out of panel from scrolling the surface
           underneath it. */
        overscroll-behavior-y: contain;
      }
      /* Only rendered on a phone, where the panel stages its edits. */
      .panel-foot {
        display: flex;
        flex: none;
        align-items: center;
        gap: 8px;
        padding: 10px 0 2px;
      }
      .panel-foot .hv-pill {
        min-width: 130px;
      }
      .footer {
        padding: 10px 20px;
        border-top: 1px solid var(--hv-row-divider);
        font-size: 12px;
        color: var(--hv-text-tertiary);
      }
      .inline-error {
        margin: 0 16px 8px;
        padding: 8px 10px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
        font-size: 12px;
      }
      .sentinel {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .editor-holder {
        border-bottom: 1px solid var(--hv-divider);
        /* The form shares a column with a table that wants every pixel it can
           get, and an overflow-y:auto box has an automatic minimum size of
           zero — so this one was free to be squeezed to nothing. It opened
           around 130px tall, a field and a half, while the ceiling below never
           came into play at all.

           Refusing to shrink turns that ceiling into the actual size and makes
           the table give the room up instead, which is exactly what already
           happens for the filter panel above it. */
        flex: none;
        /* A ceiling in dvh alone says nothing about the room this column has.
           Turn a phone on its side — 760x400 — and the app bar (64), the
           context bar (68) and the footer (41) leave 227px, while 70dvh asks
           for 280: the holder ran 13px past the bottom of the screen and took
           the footer with it. The shell clips and cannot scroll, so the sticky
           Save/Cancel bar this box pins to its own bottom edge was cut off with
           no gesture that could reach it.

           The second term measures the column itself, so the app bar's height
           is already accounted for however it lays out; the 116px is the
           context bar above the form plus the footer below it. */
        max-height: min(70dvh, calc(100% - 116px));
        overflow-y: auto;
      }
      .new-location {
        display: flex;
        gap: 6px;
        padding: 6px 16px 10px;
      }
      .new-location input {
        flex: 1;
        min-width: 0;
        box-sizing: border-box;
        background: var(--hv-surface);
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        padding: 7px 10px;
        font: 400 var(--hv-input-font, 13px) var(--hv-font);
        color: var(--hv-text);
      }
    `
], Er);
N([E({ attribute: !1 })], Y.prototype, "store", void 0), N([E({
	type: Boolean,
	reflect: !0
})], Y.prototype, "open", void 0), N([E({ type: String })], Y.prototype, "heading", void 0), N([E({ attribute: !1 })], Y.prototype, "columns", void 0), N([E({ attribute: !1 })], Y.prototype, "menuEntries", void 0), N([E({ type: Boolean })], Y.prototype, "startSelecting", void 0), N([D()], Y.prototype, "_zBase", void 0), N([D()], Y.prototype, "_filtersOpen", void 0), N([D()], Y.prototype, "_searchDraft", void 0), N([D()], Y.prototype, "_editing", void 0), N([D()], Y.prototype, "_editorBusy", void 0), N([D()], Y.prototype, "_creatingLocation", void 0), N([D()], Y.prototype, "_locationError", void 0), N([D()], Y.prototype, "_sections", void 0), N([D()], Y.prototype, "_narrow", void 0), N([D()], Y.prototype, "_stagedCount", void 0), N([D()], Y.prototype, "_selecting", void 0), N([D()], Y.prototype, "_bulkProgress", void 0), N([D()], Y.prototype, "_bulkResult", void 0), N([D()], Y.prototype, "_pendingDelete", void 0), N([D()], Y.prototype, "_loadingAll", void 0), Y = N([T("hv-full-view")], Y);
//#endregion
//#region src/ui/fuzzy.ts
function kr(e, t) {
	if (e === t) return 0;
	if (!e.length) return t.length;
	if (!t.length) return e.length;
	let n = Array.from({ length: t.length + 1 }, (e, t) => t), r = Array(t.length + 1);
	for (let i = 1; i <= e.length; i++) {
		r[0] = i;
		for (let a = 1; a <= t.length; a++) {
			let o = e[i - 1] === t[a - 1] ? 0 : 1;
			r[a] = Math.min(r[a - 1] + 1, n[a] + 1, n[a - 1] + o);
		}
		[n, r] = [r, n];
	}
	return n[t.length];
}
function Ar(e, t) {
	let n = e.trim().toLowerCase();
	if (!n) return null;
	let r = null, i = Infinity;
	for (let e of t) {
		let t = e.trim().toLowerCase();
		if (!t || t === n) continue;
		let a = kr(n, t);
		a < i && (i = a, r = e);
	}
	if (r === null) return null;
	let a = Math.max(1, Math.floor(Math.max(n.length, r.length) / 3));
	return i <= a ? r : null;
}
//#endregion
//#region src/ui/value-rewrite.ts
function jr(e, t) {
	return e === "tag" ? { tags_any: [t] } : { category: t };
}
function Mr(e, t, n, r) {
	let i = [];
	for (let a of t) if (e === "tag") {
		let e = r ? r.trim().toLowerCase() : null, t = n.trim().toLowerCase();
		if (!a.tags.some((e) => e.toLowerCase() === t)) continue;
		let o = a.tags.filter((e) => e.toLowerCase() !== t), s = cr(e ? [...o, e] : o);
		if (s.join(" ") === cr(a.tags).join(" ")) continue;
		i.push(C("item_update", {
			item_id: a.id,
			tags: s,
			expected_version: a.version
		}));
	} else {
		let e = r?.trim() || null;
		if ((a.category ?? null) === e) continue;
		i.push(C("item_update", {
			item_id: a.id,
			category: e,
			expected_version: a.version
		}));
	}
	return i;
}
function Nr(e, t, n, r) {
	let i = en(t, "item");
	return r === null ? e === "tag" ? `Removes "${n}" from ${t} ${i}.` : `Clears the category on ${t} ${i}.` : e === "tag" ? `Retags ${t} ${i}, then removes "${n}".` : `Recategorises ${t} ${i} as "${r}".`;
}
//#endregion
//#region src/components/hv-organize-dialog.ts
var Pr, Fr = {
	Merge: "Merged",
	Rename: "Renamed",
	Remove: "Removed from"
}, X = (Pr = class extends b {
	constructor(...e) {
		super(...e), this.open = !1, this.tab = "locations", this.mobile = !1, this._zBase = 0, this._filter = "", this._editingLocation = null, this._locName = "", this._locArea = null, this._locParent = null, this._locParentOpen = !1, this._locError = null, this._guard = null, this._mergingLocation = null, this._mergeTarget = null, this._mergeTargetOpen = !1, this._sheetLocation = null, this._editingValue = null, this._valueDraft = "", this._rewrite = null, this._confirmRemove = null, this._sheetValue = null, this._creatingValue = !1, this._newValue = "", this._newValueError = null, this._dialogFocus = new Zt(), this._close = () => {
			this.open = !1, this.dispatchEvent(new CustomEvent("cancel", {
				bubbles: !0,
				composed: !0
			}));
		};
	}
	get st() {
		return this.store?.state.value ?? null;
	}
	connectedCallback() {
		super.connectedCallback(), this.store && !this._storeUnsub && (this._storeUnsub = this.store.state.onChange(() => this.requestUpdate()));
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._storeUnsub?.(), this._storeUnsub = void 0;
	}
	updated() {
		this._dialogFocus.sync(this.open, () => this.renderRoot.querySelector("[data-testid=\"organize-dialog\"]"));
	}
	willUpdate(e) {
		e.has("store") && this.store && (this._storeUnsub?.(), this._storeUnsub = this.store.state.onChange(() => this.requestUpdate())), e.has("open") && this.open && (this._zBase = M(), this._resetTransient()), e.has("tab") && this._resetTransient();
	}
	_resetTransient() {
		this._filter = "", this._editingLocation = null, this._editingValue = null, this._guard = null, this._locError = null, this._rewrite = null, this._sheetValue = null, this._creatingValue = !1, this._newValue = "", this._newValueError = null, this._mergingLocation = null, this._mergeTarget = null, this._mergeTargetOpen = !1, this._sheetLocation = null;
	}
	_findNode(e, t) {
		for (let n of e) {
			if (n.id === t) return n;
			let e = this._findNode(n.children ?? [], t);
			if (e) return e;
		}
		return null;
	}
	_startLocationEdit(e) {
		let t = e === "new" ? null : this._findNode(this.st?.locationTreeCache ?? [], e);
		this._mergingLocation = null, this._sheetLocation = null, this._editingLocation = e, this._locName = t?.name ?? "", this._locArea = t?.area_id ?? null, this._locParent = t?.parent_id ?? null, this._locParentOpen = !1, this._locError = null, this._guard = null;
	}
	async _saveLocation() {
		let e = this._locName.trim();
		if (!e) {
			this._locError = "A location needs a name.";
			return;
		}
		this._locError = null;
		try {
			if (this._editingLocation === "new") await this.store?.createLocation(e, this._locParent, this._locArea);
			else if (this._editingLocation) {
				let t = this._findNode(this.st?.locationTreeCache ?? [], this._editingLocation);
				await this.store?.updateLocation(this._editingLocation, {
					name: e,
					areaId: this._locArea,
					...t && (t.parent_id ?? null) !== this._locParent ? { newParentId: this._locParent } : {}
				});
			}
			this._editingLocation = null;
		} catch (e) {
			this._locError = e?.message ?? "Could not save that location.";
		}
	}
	async _deleteLocation(e) {
		let t = e.children?.length ?? 0, n = e.subtree_item_count ?? 0;
		if (t > 0 || n > 0) {
			let r = [];
			n && r.push(P(n, "item")), t && r.push(P(t, "sub-location")), this._guard = {
				locationId: e.id,
				message: `"${e.name}" still contains ${r.join(" and ")}. Move or delete them first.`
			};
			return;
		}
		this._guard = null;
		try {
			await this.store?.deleteLocation(e.id);
		} catch (t) {
			this._guard = {
				locationId: e.id,
				message: t?.message ?? "Could not delete that location."
			};
		}
	}
	_startLocationMerge(e) {
		this._editingLocation = null, this._sheetLocation = null, this._guard = null, this._rewrite = null, this._mergingLocation = e, this._mergeTarget = null, this._mergeTargetOpen = !1;
	}
	async _runLocationMerge(e, t) {
		let n = "Merge";
		this._mergingLocation = null, this._rewrite = {
			label: n,
			done: 0,
			total: 0,
			failed: [],
			finished: !1,
			error: null
		};
		let r;
		try {
			r = await this.store?.listAllMatching({
				location_id: e.id,
				include_subtree: !1
			}) ?? [];
		} catch (e) {
			this._rewrite = {
				label: n,
				done: 0,
				total: 0,
				failed: [],
				finished: !0,
				error: e?.message ?? "Could not read that location’s items."
			};
			return;
		}
		let i = r.map((e) => C("item_move", {
			item_id: e.id,
			location_id: t,
			expected_version: e.version
		}));
		this._rewrite = {
			label: n,
			done: 0,
			total: i.length,
			failed: [],
			finished: !1,
			error: null
		};
		let a = (i.length ? await this.store?.bulkExecute(i, { onProgress: (e, t) => {
			this._rewrite = {
				label: n,
				done: e,
				total: t,
				failed: [],
				finished: !1,
				error: null
			};
		} }) : void 0)?.failed ?? [], o = null;
		if (a.length) o = `"${e.name}" was kept: ${P(a.length, "item")} could not be moved.`;
		else try {
			for (let n of e.children ?? []) await this.store?.moveLocationSubtree(n.id, t);
			await this.store?.deleteLocation(e.id);
		} catch (t) {
			o = t?.message ?? `Moved the items, but "${e.name}" could not be removed.`;
		}
		this._rewrite = {
			label: n,
			done: i.length,
			total: i.length,
			failed: a,
			finished: !0,
			error: o
		};
	}
	get _kind() {
		return this.tab === "tags" ? "tag" : "category";
	}
	get _values() {
		let e = this.st?.distinctValuesCache, t = this.tab === "tags" ? e?.tags ?? [] : e?.categories ?? [], n = this._filter.trim().toLowerCase();
		return n ? t.filter((e) => e.value.toLowerCase().includes(n)) : t;
	}
	get _noun() {
		return this.tab === "tags" ? "tag" : "category";
	}
	_isDraft(e) {
		return this.store?.isDraftValue(this._kind, e) ?? !1;
	}
	_createValue() {
		let e = this._newValue.trim();
		if (!e) {
			this._newValueError = `A ${this._noun} needs a name.`;
			return;
		}
		if (!this.store?.addDraftValue(this._kind, e)) {
			this._newValueError = `"${e}" already exists.`;
			return;
		}
		this._creatingValue = !1, this._newValue = "", this._newValueError = null;
	}
	_startValueEdit(e, t) {
		if (this._editingValue = {
			value: e,
			mode: t
		}, this._sheetValue = null, this._rewrite = null, t === "merge") {
			let t = (this.tab === "tags" ? this.st?.distinctValuesCache?.tags ?? [] : this.st?.distinctValuesCache?.categories ?? []).map((e) => e.value);
			this._valueDraft = Ar(e, t) ?? "";
		} else this._valueDraft = e;
	}
	async _runRewrite(e, t, n) {
		let r = this._kind;
		this._rewrite = {
			label: n,
			done: 0,
			total: 0,
			failed: [],
			finished: !1
		};
		let i;
		try {
			i = await this.store?.listAllMatching(jr(r, e)) ?? [];
		} catch {
			this._rewrite = {
				label: n,
				done: 0,
				total: 0,
				failed: [],
				finished: !0
			};
			return;
		}
		let a = Mr(r, i, e, t);
		if (!a.length) {
			this._rewrite = {
				label: n,
				done: 0,
				total: 0,
				failed: [],
				finished: !0
			}, this._editingValue = null;
			return;
		}
		this._rewrite = {
			label: n,
			done: 0,
			total: a.length,
			failed: [],
			finished: !1
		};
		let o = await this.store?.bulkExecute(a, { onProgress: (e, t) => {
			this._rewrite = {
				label: n,
				done: e,
				total: t,
				failed: this._rewrite?.failed ?? [],
				finished: !1
			};
		} });
		this._rewrite = {
			label: n,
			done: a.length,
			total: a.length,
			failed: o?.failed ?? [],
			finished: !0
		}, this._editingValue = null, await this.store?.refreshDistinctValues().catch(() => void 0);
	}
	_showValue(e) {
		this.tab === "tags" ? this.store?.setFilters({
			tags: [e],
			tagsMode: "any"
		}) : this.store?.setFilters({ category: e }), this._browse();
	}
	_showLocation(e) {
		e && (this.store?.setFilters({
			locationId: e,
			orphansOnly: !1
		}), this._browse());
	}
	_browse() {
		this.dispatchEvent(new CustomEvent("browse", {
			bubbles: !0,
			composed: !0
		})), this._close();
	}
	_renderLocationEditor(e) {
		let t = this.st?.locationTreeCache ?? [], n = e === "new" ? null : this._findNode(t, e), r = this._locParent ? this._findNode(t, this._locParent) : null, i = this.st?.areasCache?.areas ?? [], a = r ? "Inherit from location tree" : "No area";
		return v`<div class="expander" data-testid="location-editor">
      <div class="grid2">
        <div class="cell">
          <label class="hv-label" for="org-loc-name">Name</label>
          <input
            id="org-loc-name"
            class="control"
            data-testid="location-name"
            .value=${this._locName}
            @input=${(e) => {
			this._locName = e.target.value;
		}}
          />
        </div>
        <div class="cell">
          <label class="hv-label" for="org-loc-area">Area (HA)</label>
          <select
            id="org-loc-area"
            class="control"
            data-testid="location-area"
            @change=${(e) => {
			this._locArea = e.target.value || null;
		}}
          >
            <option value="" ?selected=${!this._locArea}>${a}</option>
            ${i.map((e) => v`<option value=${e.id} ?selected=${this._locArea === e.id}>${e.name}</option>`)}
          </select>
        </div>
        <div class="cell wide">
          <span class="hv-label">
            Parent location
            <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--hv-text-tertiary)">
              (moves whole subtree)
            </span>
          </span>
          <button
            class="control"
            data-testid="location-parent"
            aria-expanded=${String(this._locParentOpen)}
            @click=${() => {
			this._locParentOpen = !this._locParentOpen;
		}}
          >
            ${j("mapMarker", 15)}<span class="value">${r?.name ?? "Top level"}</span>
            ${j("chevronDown", 15)}
          </button>
          ${this._locParentOpen ? v`<div class="tree-holder">
                <hv-location-tree
                  data-testid="location-parent-tree"
                  .nodes=${t}
                  .selectedId=${this._locParent}
                  .excludeSubtreeOf=${n?.id ?? null}
                  showAll
                  @select=${(e) => {
			this._locParent = e.detail.locationId, this._locParentOpen = !1;
		}}
                ></hv-location-tree>
              </div>` : null}
        </div>
      </div>
      ${this._locError ? v`<div class="failure" role="alert" data-testid="location-error">${this._locError}</div>` : null}
      <div class="actions">
        ${n ? v`<button
              class="hv-text-button danger"
              data-testid="location-delete"
              @click=${() => void this._deleteLocation(n)}
            >
              Delete
            </button>` : null}
        <span class="spacer"></span>
        <button
          class="hv-text-button"
          data-testid="location-cancel"
          @click=${() => {
			this._editingLocation = null;
		}}
        >
          Cancel
        </button>
        <button class="hv-pill" data-testid="location-save" @click=${() => void this._saveLocation()}>
          Save
        </button>
      </div>
    </div>`;
	}
	_renderLocationSheet(e) {
		let t = e.subtree_item_count ?? 0;
		return v`<div class="expander" data-testid="location-sheet">
      <div class="sheet-actions">
        <button data-testid="location-sheet-show" @click=${() => this._showLocation(e.id)}>
          ${j("magnify", 20)}Show ${P(t, "item")}
        </button>
        <button data-testid="location-sheet-edit" @click=${() => this._startLocationEdit(e.id)}>
          ${j("pencil", 20)}Edit…
        </button>
        <button data-testid="location-sheet-merge" @click=${() => this._startLocationMerge(e.id)}>
          ${j("callMerge", 20)}Merge into…
        </button>
        <button
          class="danger"
          data-testid="location-sheet-delete"
          @click=${() => {
			this._sheetLocation = null, this._deleteLocation(e);
		}}
        >
          ${j("del", 20)}Delete
        </button>
      </div>
    </div>`;
	}
	_renderLocationMerge(e) {
		let t = this.st?.locationTreeCache ?? [], n = this._mergeTarget ? this._findNode(t, this._mergeTarget) : null, r = e.direct_item_count ?? 0, i = e.children?.length ?? 0, a = [P(r, "item")];
		return i && a.push(P(i, "sub-location")), v`<div class="expander" data-testid="location-merge">
      <div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap">
        <span class="value-chip" style="text-decoration: line-through">${e.name}</span>
        ${j("arrowRight", 18)}
        <button
          class="control"
          style="flex:1;min-width:180px"
          data-testid="merge-target"
          aria-expanded=${String(this._mergeTargetOpen)}
          @click=${() => {
			this._mergeTargetOpen = !this._mergeTargetOpen;
		}}
        >
          ${j("mapMarker", 15)}<span class="value">${n?.name ?? "merge into…"}</span>
          ${j("chevronDown", 15)}
        </button>
      </div>
      ${this._mergeTargetOpen ? v`<div class="tree-holder">
            <hv-location-tree
              data-testid="merge-target-tree"
              .nodes=${t}
              .selectedId=${this._mergeTarget}
              .excludeSubtreeOf=${e.id}
              @select=${(e) => {
			this._mergeTarget = e.detail.locationId, this._mergeTargetOpen = !1;
		}}
            ></hv-location-tree>
          </div>` : null}
      <span class="note" data-testid="merge-effect">
        ${n ? `${a.join(" and ")} move to "${n.name}", then "${e.name}" is deleted.
             Items in sub-locations stay where they are; their paths just change.` : "Pick a location to continue."}
      </span>
      <div class="actions">
        <span class="spacer"></span>
        <button
          class="hv-text-button"
          data-testid="merge-cancel"
          @click=${() => {
			this._mergingLocation = null;
		}}
        >
          Cancel
        </button>
        <button
          class="hv-pill"
          data-testid="merge-apply"
          ?disabled=${!this._mergeTarget}
          @click=${() => {
			this._mergeTarget && this._runLocationMerge(e, this._mergeTarget);
		}}
        >
          Merge
        </button>
      </div>
    </div>`;
	}
	_renderLocationsTab() {
		let e = this.st?.locationTreeCache ?? [], t = this._mergingLocation ? this._findNode(e, this._mergingLocation) : null, n = this._sheetLocation ? this._findNode(e, this._sheetLocation) : null, r = nt(e, this._filter);
		return v`
      <div class="toolbar">
        <label class="search">
          ${j("magnify", 17)}
          <span class="hv-sr-only">Filter locations</span>
          <input
            data-testid="organize-filter"
            placeholder="Filter locations…"
            .value=${this._filter}
            @input=${(e) => {
			this._filter = e.target.value;
		}}
          />
        </label>
        <span class="toolbar-count" data-testid="organize-location-count">
          ${P(r, "location")}
        </span>
        <button
          class="hv-pill"
          data-testid="organize-new-location"
          @click=${() => this._startLocationEdit("new")}
        >
          ${j("plus", 15)}New location
        </button>
      </div>
      <div class="body">
        ${this._editingLocation === "new" ? this._renderLocationEditor("new") : null}
        ${this._rewrite ? this._renderRewrite() : null}
        <hv-location-tree
          data-testid="organize-tree"
          manage
          showCounts
          showAreas
          ?mobile=${this.mobile}
          .nodes=${e}
          .areas=${this.st?.areasCache?.areas ?? []}
          .filterText=${this._filter}
          @select=${(e) => this._showLocation(e.detail.locationId)}
          @edit-location=${(e) => this._startLocationEdit(e.detail.locationId)}
          @merge-location=${(e) => this._startLocationMerge(e.detail.locationId)}
          @more-location=${(e) => {
			let { locationId: t } = e.detail;
			this._sheetLocation = this._sheetLocation === t ? null : t, this._editingLocation = null, this._mergingLocation = null;
		}}
          @delete-location=${(e) => {
			let t = e.detail.node;
			this._deleteLocation(t);
		}}
        ></hv-location-tree>
        ${n ? this._renderLocationSheet(n) : null}
        ${t ? this._renderLocationMerge(t) : null}
        ${this._editingLocation && this._editingLocation !== "new" ? this._renderLocationEditor(this._editingLocation) : null}
        ${this._guard ? v`<div class="guard" role="alert" data-testid="location-guard">
              <span class="glyph">${j("alert", 17)}</span>
              <span>${this._guard.message}</span>
            </div>` : null}
      </div>
    `;
	}
	_rewriteSummary(e) {
		if (!e.finished) return `${e.label} ${e.done} of ${e.total}`;
		if (!e.total) return `Nothing to ${e.label.toLowerCase()}.`;
		let t = e.total - e.failed.length, n = Fr[e.label] ?? e.label;
		return e.failed.length ? `${n} ${t} of ${P(e.total, "item")}` : `${n} ${P(e.total, "item")}`;
	}
	_renderRewrite() {
		let e = this._rewrite;
		if (!e) return null;
		let t = e.total ? Math.round(e.done / e.total * 100) : 100, n = e.failed.length > 0 || !!e.error;
		return v`<div class="expander" data-testid="rewrite-status">
      <div style="display:flex;gap:8px;font-size:12.5px">
        <span data-testid="rewrite-label">${this._rewriteSummary(e)}</span>
        ${e.failed.length ? v`<span style="margin-left:auto" data-testid="rewrite-failed"
              >${e.failed.length} failed</span
            >` : null}
      </div>
      ${e.finished ? null : v`<div class="track"><div class="fill" style="width:${t}%"></div></div>`}
      ${e.error ? v`<div class="failure" role="alert" data-testid="rewrite-error">
            ${j("alertCircle", 16)}<span>${e.error}</span>
          </div>` : null}
      ${e.failed.map((e) => v`<div class="failure" data-testid="rewrite-failure">
          ${j("alertCircle", 16)}<span>${e.itemId} — ${Cr(e)}</span>
        </div>`)}
      ${e.finished && !n ? null : v`<span class="note">
              Sent as one batch call · already-rewritten items keep the new value, so cancelling or a
              failure part-way is not undone.
            </span>`}
      <div class="actions">
        <span class="spacer"></span>
        <button
          class="hv-text-button"
          data-testid="rewrite-dismiss"
          @click=${() => {
			this._rewrite = null;
		}}
        >
          Dismiss
        </button>
      </div>
    </div>`;
	}
	_renderValueEditor(e, t) {
		let n = this._editingValue, r = n.mode === "merge", i = (this.tab === "tags" ? this.st?.distinctValuesCache?.tags ?? [] : this.st?.distinctValuesCache?.categories ?? []).map((e) => e.value).filter((t) => t !== e), a = this._valueDraft.trim();
		return v`<div class="expander" data-testid="value-editor" data-mode=${n.mode}>
      <div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap">
        <span class="value-chip" style=${r ? "text-decoration: line-through" : ""}>${e}</span>
        <span style="font-size:12.5px;color:var(--hv-text-secondary)">${P(t, "item")}</span>
        ${r ? j("arrowRight", 18) : null}
        <label style="display:flex;align-items:center;gap:8px;flex:1;min-width:180px">
          <span class="hv-sr-only">${r ? "Merge into" : "New name"}</span>
          <input
            class="control"
            data-testid="value-target"
            list="hv-organize-values"
            placeholder=${r ? "merge into…" : "new name…"}
            .value=${this._valueDraft}
            @input=${(e) => {
			this._valueDraft = e.target.value;
		}}
          />
        </label>
        <datalist id="hv-organize-values">
          ${i.map((e) => v`<option value=${e}></option>`)}
        </datalist>
      </div>
      <span class="note" data-testid="value-effect">
        ${a ? Nr(this._kind, t, e, a) : "Pick a name to continue."}
      </span>
      <div class="actions">
        <span class="spacer"></span>
        <button
          class="hv-text-button"
          data-testid="value-cancel"
          @click=${() => {
			this._editingValue = null;
		}}
        >
          Cancel
        </button>
        <button
          class="hv-pill"
          data-testid="value-apply"
          ?disabled=${!a || a === e}
          @click=${() => void this._runRewrite(e, a, r ? "Merge" : "Rename")}
        >
          ${r ? "Merge" : "Rename"}
        </button>
      </div>
    </div>`;
	}
	_renderValueCreator() {
		return v`<div class="expander" data-testid="value-create">
      <label style="display:flex;align-items:center;gap:8px">
        <span class="hv-sr-only">New ${this._noun}</span>
        <input
          class="control"
          data-testid="new-value-name"
          placeholder=${`New ${this._noun}…`}
          .value=${this._newValue}
          @input=${(e) => {
			this._newValue = e.target.value, this._newValueError = null;
		}}
          @keydown=${(e) => {
			e.key === "Enter" && this._createValue();
		}}
        />
      </label>
      ${this._newValueError ? v`<div class="failure" role="alert" data-testid="new-value-error">${this._newValueError}</div>` : null}
      <span class="note">
        A ${this._noun} exists through the items using it — there is nothing to create on the server. This
        one is kept on the card and offered while editing items, until an item takes it.
      </span>
      <div class="actions">
        <span class="spacer"></span>
        <button
          class="hv-text-button"
          data-testid="new-value-cancel"
          @click=${() => {
			this._creatingValue = !1, this._newValueError = null;
		}}
        >
          Cancel
        </button>
        <button
          class="hv-pill"
          data-testid="new-value-create"
          ?disabled=${!this._newValue.trim()}
          @click=${() => this._createValue()}
        >
          Create
        </button>
      </div>
    </div>`;
	}
	_renderValuesTab() {
		let e = this._values, t = this.tab === "tags" ? "tags" : "categories";
		return v`
      <div class="toolbar">
        <label class="search">
          ${j("magnify", 17)}
          <span class="hv-sr-only">Filter ${t}</span>
          <input
            data-testid="organize-filter"
            placeholder=${`Filter ${t}…`}
            .value=${this._filter}
            @input=${(e) => {
			this._filter = e.target.value;
		}}
          />
        </label>
        <span class="toolbar-count" data-testid="organize-value-count">${P(e.length, this._noun, t)}</span>
        <button
          class="hv-pill"
          data-testid="organize-new-value"
          @click=${() => {
			this._creatingValue = !0, this._newValue = "", this._newValueError = null, this._editingValue = null;
		}}
        >
          ${j("plus", 15)}New ${this._noun}
        </button>
      </div>
      <div class="body">
        ${this._creatingValue ? this._renderValueCreator() : null}
        ${this._rewrite ? this._renderRewrite() : null}
        ${e.length ? e.map((e) => v`
                <div class="value-row" data-testid="value-row" data-value=${e.value}>
                  <span class="value-chip">${e.value}</span>
                  ${this._isDraft(e.value) ? v`<span class="draft-note" data-testid="value-draft">
                        new · not saved until an item uses it
                      </span>` : v`<button
                        class="count-link"
                        data-testid="value-count"
                        @click=${() => this._showValue(e.value)}
                      >
                        ${P(e.count, "item")}
                      </button>`}
                  <span class="row-actions">
                    ${this._isDraft(e.value) ? v`<button
                          class="danger"
                          data-testid="value-discard"
                          aria-label=${`Discard ${e.value}`}
                          title="Discard"
                          @click=${() => this.store?.removeDraftValue(this._kind, e.value)}
                        >
                          ${j("del", 16)}
                        </button>` : this.mobile ? v`<button
                          data-testid="value-more"
                          aria-label=${`Actions for ${e.value}`}
                          @click=${() => {
			this._sheetValue = e.value;
		}}
                        >
                          ${j("dotsVertical", 17)}
                        </button>` : v`
                          <button
                            data-testid="value-rename"
                            aria-label=${`Rename ${e.value}`}
                            title="Rename"
                            @click=${() => this._startValueEdit(e.value, "rename")}
                          >
                            ${j("pencil", 16)}
                          </button>
                          <button
                            data-testid="value-merge"
                            aria-label=${`Merge ${e.value}`}
                            title="Merge into another"
                            @click=${() => this._startValueEdit(e.value, "merge")}
                          >
                            ${j("callMerge", 16)}
                          </button>
                          <button
                            class="danger"
                            data-testid="value-remove"
                            aria-label=${`Remove ${e.value}`}
                            title="Remove from every item"
                            @click=${() => {
			this._confirmRemove = e.value;
		}}
                          >
                            ${j("del", 16)}
                          </button>
                        `}
                  </span>
                </div>
                ${this._editingValue?.value === e.value ? this._renderValueEditor(e.value, e.count) : null}
                ${this._sheetValue === e.value ? this._renderValueSheet(e.value, e.count) : null}
              `) : v`<div class="empty" data-testid="organize-empty">
              ${this._filter.trim() ? `No ${t} match` : `No ${t} in use yet`}
            </div>`}
      </div>
    `;
	}
	_renderValueSheet(e, t) {
		let n = Ar(e, (this.tab === "tags" ? this.st?.distinctValuesCache?.tags ?? [] : this.st?.distinctValuesCache?.categories ?? []).map((e) => e.value).filter((t) => t !== e));
		return v`<div class="expander" data-testid="value-sheet">
      <div class="sheet-actions">
        <button data-testid="sheet-show" @click=${() => this._showValue(e)}>
          ${j("magnify", 20)}Show ${P(t, "item")}
        </button>
        <button data-testid="sheet-rename" @click=${() => this._startValueEdit(e, "rename")}>
          ${j("pencil", 20)}Rename…
        </button>
        <button data-testid="sheet-merge" @click=${() => this._startValueEdit(e, "merge")}>
          ${j("callMerge", 20)}Merge into…
          ${n ? v`<span class="value-chip" style="margin-left:auto" data-testid="sheet-merge-suggestion"
                >${n}</span
              >` : null}
        </button>
        <button
          class="danger"
          data-testid="sheet-remove"
          @click=${() => {
			this._sheetValue = null, this._confirmRemove = e;
		}}
        >
          ${j("del", 20)}Remove from all items
        </button>
      </div>
    </div>`;
	}
	render() {
		if (!this.open) return null;
		let e = this._zBase || 9998, t = this._values.find((e) => e.value === this._confirmRemove)?.count ?? (this.tab === "tags" ? this.st?.distinctValuesCache?.tags ?? [] : this.st?.distinctValuesCache?.categories ?? []).find((e) => e.value === this._confirmRemove)?.count ?? 0;
		return v`
      <div class="backdrop" role="presentation" style="z-index:${e}" @click=${this._close}></div>
      <div class="wrap" role="none" style="z-index:${e + 1}">
        <div
          class="panel"
          role="dialog"
          aria-modal="true"
          aria-label="Organize inventory"
          data-testid="organize-dialog"
          @keydown=${A(() => this._close())}
        >
          <div class="head">
            ${this.mobile ? v`<button class="hv-icon-button" data-testid="organize-back" aria-label="Back" @click=${this._close}>
                  ${j("arrowLeft", 21)}
                </button>` : null}
            <h2>${this.mobile ? "Organize" : "Organize inventory"}</h2>
            ${this.mobile ? null : v`<button class="hv-icon-button" data-testid="organize-close" aria-label="Close" @click=${this._close}>
                  ${j("close", 20)}
                </button>`}
          </div>
          <div class="tabs" role="tablist">
            ${[
			"locations",
			"categories",
			"tags"
		].map((e) => v`<button
                class=${this.tab === e ? "on" : ""}
                role="tab"
                aria-selected=${String(this.tab === e)}
                data-testid="organize-tab"
                data-tab=${e}
                @click=${() => {
			this.tab = e;
		}}
              >
                ${e === "locations" ? "Locations" : e === "categories" ? "Categories" : "Tags"}
              </button>`)}
          </div>
          ${this.tab === "locations" ? this._renderLocationsTab() : this._renderValuesTab()}
        </div>
      </div>

      <hv-confirm
        data-testid="organize-confirm"
        ?open=${this._confirmRemove !== null}
        .heading=${`Remove "${this._confirmRemove}" from ${P(t, "item")}?`}
        message="The value is cleared on every item that carries it. The items themselves are not deleted."
        confirmLabel="Remove"
        destructive
        @confirm=${() => {
			let e = this._confirmRemove;
			this._confirmRemove = null, e && this._runRewrite(e, null, "Remove");
		}}
        @cancel=${() => {
			this._confirmRemove = null;
		}}
      ></hv-confirm>
    `;
	}
}, Pr.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
      }
      .wrap {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        box-sizing: border-box;
      }
      :host([mobile]) .wrap {
        padding: 0;
        place-items: stretch;
      }
      .panel {
        width: 620px;
        max-width: 100%;
        max-height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: var(--hv-radius-dialog);
        box-shadow: var(--hv-shadow-dialog);
        overflow: hidden;
      }
      /* Mobile is a full-bleed page, not a floating modal. */
      :host([mobile]) .panel {
        width: 100%;
        height: 100%;
        max-height: none;
        border-radius: 0;
        box-shadow: none;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 15px 20px 12px;
      }
      :host([mobile]) .head {
        padding: 6px 8px 6px 4px;
        border-bottom: 1px solid var(--hv-divider);
      }
      .head h2 {
        margin: 0;
        flex: 1;
        font-size: 18px;
        font-weight: 500;
      }
      :host([mobile]) .head h2 {
        font-size: 17px;
      }
      .tabs {
        display: flex;
        border-bottom: 1px solid var(--hv-divider);
        padding: 0 20px;
      }
      :host([mobile]) .tabs {
        padding: 0;
      }
      .tabs button {
        border: none;
        background: none;
        padding: 8px 16px 10px;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text-secondary);
        border-bottom: 2px solid transparent;
      }
      :host([mobile]) .tabs button {
        flex: 1;
        padding: 12px 0;
      }
      .tabs button.on {
        color: var(--hv-primary-darker);
        font-weight: 500;
        border-bottom-color: var(--hv-primary);
      }
      .toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 20px 10px;
      }
      .search {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--hv-input-bg);
        border-radius: var(--hv-radius-chip);
        padding: 9px 14px;
        color: var(--hv-text-secondary);
      }
      .search input {
        flex: 1;
        min-width: 0;
        border: none;
        background: none;
        outline: none;
        font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
        color: var(--hv-text);
      }
      /* How many of this tab's thing there is — every tab prints one, hence a
         shared class. nowrap because on a phone the row has no width to spare
         and "13 locations" would break over two lines. */
      .toolbar-count {
        flex: none;
        white-space: nowrap;
        font-size: 12.5px;
        color: var(--hv-text-secondary);
      }
      /* Three items in a 335px row left the filter field 110px wide, with its own
         placeholder clipped to "Filter loca". The field takes the row and the
         count keeps the button company on the next one. */
      :host([mobile]) .toolbar {
        flex-wrap: wrap;
      }
      :host([mobile]) .search {
        flex-basis: 100%;
      }
      :host([mobile]) .toolbar-count {
        margin-right: auto;
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 4px 14px 16px;
      }
      .value-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 11px 8px;
        border-radius: var(--hv-radius-input);
      }
      .value-row:hover {
        background: var(--hv-hover-overlay);
      }
      .value-chip {
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-chip);
        padding: 4px 11px;
        font-size: 12.5px;
        color: var(--hv-chip-text);
      }
      .count-link {
        border: none;
        background: none;
        color: var(--hv-primary-dark);
        font: 400 12px var(--hv-font);
        padding: 0;
      }
      .draft-note {
        font: 400 12px var(--hv-font);
        color: var(--hv-text-tertiary);
        font-style: italic;
      }
      .row-actions {
        margin-left: auto;
        display: flex;
        gap: 2px;
      }
      :host(:not([mobile])) .value-row .row-actions {
        visibility: hidden;
      }
      :host(:not([mobile])) .value-row:hover .row-actions,
      :host(:not([mobile])) .value-row:focus-within .row-actions {
        visibility: visible;
      }
      .row-actions button {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--hv-text-secondary);
        padding: 0;
      }
      .row-actions button.danger {
        color: var(--hv-error);
      }
      .row-actions button:hover {
        background: var(--hv-hover-overlay);
      }
      .expander {
        background: var(--hv-row-hover);
        border-left: 3px solid var(--hv-primary);
        border-radius: 0 10px 10px 0;
        padding: 12px 14px 14px;
        margin: 0 0 6px 8px;
        display: grid;
        gap: 11px;
      }
      .grid2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      :host([mobile]) .grid2 {
        grid-template-columns: 1fr;
      }
      .cell {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      .cell.wide {
        grid-column: span 2;
      }
      :host([mobile]) .cell.wide {
        grid-column: span 1;
      }
      .control {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        background: var(--hv-surface);
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        padding: 9px 11px;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
        text-align: left;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      :host([mobile]) .control {
        min-height: 46px;
        font-size: 15px;
      }
      .control .value {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tree-holder {
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        background: var(--hv-surface);
        max-height: 200px;
        overflow: auto;
        padding: 4px 0;
        margin-top: 6px;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .actions .spacer {
        margin-left: auto;
      }
      .guard {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        padding: 10px 12px;
        margin: 0 8px 8px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
        font-size: 12.5px;
        line-height: 1.5;
      }
      .guard .glyph {
        color: var(--hv-warn);
        flex: none;
      }
      .track {
        height: 6px;
        border-radius: 999px;
        background: var(--hv-divider);
        overflow: hidden;
      }
      .fill {
        height: 100%;
        background: var(--hv-primary);
        transition: width var(--hv-motion-panel) ease-out;
      }
      .failure {
        display: flex;
        gap: 8px;
        padding: 9px 11px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-error-bg);
        color: var(--hv-error-deep);
        font-size: 12.5px;
      }
      .note {
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
        line-height: 1.5;
      }
      .empty {
        padding: 24px 10px;
        text-align: center;
        color: var(--hv-text-tertiary);
        font-size: 13px;
      }
      .sheet-actions {
        display: grid;
        gap: 2px;
      }
      .sheet-actions button {
        display: flex;
        align-items: center;
        gap: 14px;
        border: none;
        background: none;
        color: var(--hv-text);
        padding: 13px 4px;
        font: 400 14.5px var(--hv-font);
        text-align: left;
      }
      .sheet-actions button.danger {
        color: var(--hv-error-soft);
      }
    `
], Pr);
N([E({ attribute: !1 })], X.prototype, "store", void 0), N([E({
	type: Boolean,
	reflect: !0
})], X.prototype, "open", void 0), N([E({ type: String })], X.prototype, "tab", void 0), N([E({
	type: Boolean,
	reflect: !0
})], X.prototype, "mobile", void 0), N([D()], X.prototype, "_zBase", void 0), N([D()], X.prototype, "_filter", void 0), N([D()], X.prototype, "_editingLocation", void 0), N([D()], X.prototype, "_locName", void 0), N([D()], X.prototype, "_locArea", void 0), N([D()], X.prototype, "_locParent", void 0), N([D()], X.prototype, "_locParentOpen", void 0), N([D()], X.prototype, "_locError", void 0), N([D()], X.prototype, "_guard", void 0), N([D()], X.prototype, "_mergingLocation", void 0), N([D()], X.prototype, "_mergeTarget", void 0), N([D()], X.prototype, "_mergeTargetOpen", void 0), N([D()], X.prototype, "_sheetLocation", void 0), N([D()], X.prototype, "_editingValue", void 0), N([D()], X.prototype, "_valueDraft", void 0), N([D()], X.prototype, "_rewrite", void 0), N([D()], X.prototype, "_confirmRemove", void 0), N([D()], X.prototype, "_sheetValue", void 0), N([D()], X.prototype, "_creatingValue", void 0), N([D()], X.prototype, "_newValue", void 0), N([D()], X.prototype, "_newValueError", void 0), X = N([T("hv-organize-dialog")], X);
//#endregion
//#region src/ui/health-codes.ts
var Ir = {
	item_id_key_mismatch: "{n} item(s) are stored under a key that does not match their id.",
	item_references_missing_location: "{n} item(s) reference a location that no longer exists — they appear under \"No location\".",
	item_missing_from_items_by_location_index: "{n} item(s) are missing from the location index.",
	checked_out_item_missing_from_index: "{n} checked-out item(s) are missing from the checked-out index.",
	non_checked_out_item_present_in_index: "{n} item(s) are in the checked-out index but are not checked out.",
	low_stock_item_missing_from_index: "{n} low-stock item(s) are missing from the low-stock index.",
	non_low_stock_item_present_in_index: "{n} item(s) are in the low-stock index but are not low on stock.",
	tags_index_references_unknown_item_ids: "The tag index references {n} item(s) that no longer exist.",
	category_index_references_unknown_item_ids: "The category index references {n} item(s) that no longer exist.",
	checked_out_index_references_unknown_item_ids: "The checked-out index references {n} item(s) that no longer exist.",
	low_stock_index_references_unknown_item_ids: "The low-stock index references {n} item(s) that no longer exist.",
	items_by_location_index_references_unknown_item_ids: "The location index references {n} item(s) that no longer exist.",
	items_by_location_references_missing_location: "The location index has {n} bucket(s) for missing locations.",
	items_by_location_bucket_mismatch: "{n} location bucket(s) disagree with the items they hold.",
	location_id_key_mismatch: "{n} location(s) are stored under a key that does not match their id.",
	items_total_count_mismatch: "The cached item total disagrees with the stored items.",
	locations_total_count_mismatch: "The cached location total disagrees with the stored locations.",
	checked_out_count_mismatch: "The cached checked-out count disagrees with the stored items.",
	low_stock_count_mismatch: "The cached low-stock count disagrees with the stored items."
};
function Lr(e) {
	if (!e?.length) return [];
	let t = /* @__PURE__ */ new Map();
	for (let n of e) {
		let e = String(n);
		t.set(e, (t.get(e) ?? 0) + 1);
	}
	return [...t.entries()].map(([e, t]) => ({
		code: e,
		count: t,
		message: Ir[e]?.replace("{n}", String(t)) ?? e
	}));
}
//#endregion
//#region src/components/hv-diagnostics-panel.ts
var Rr, Z = (Rr = class extends b {
	constructor(...e) {
		super(...e), this.open = !1, this.health = null, this.counts = null, this.version = null, this.degraded = null, this.connected = null, this.loadedItems = 0, this.lastRefresh = null, this.busy = !1, this._zBase = 0, this._copied = !1, this._dialogFocus = new Zt(), this._close = () => {
			this.open = !1, this.dispatchEvent(new CustomEvent("cancel", {
				bubbles: !0,
				composed: !0
			}));
		};
	}
	updated() {
		this._dialogFocus.sync(this.open, () => this.renderRoot.querySelector("[data-testid=\"diagnostics-panel\"]"));
	}
	willUpdate(e) {
		e.has("open") && this.open && (this._zBase = M(), this._copied = !1);
	}
	get report() {
		let e = Lr(this.health?.issues);
		return [
			"HAventory diagnostics",
			`integration ${this.version?.integration_version ?? "unknown"} · schema ${this.version?.schema_version ?? "?"}`,
			`healthy: ${this.health?.healthy ?? "unknown"} · generation ${this.health?.generation ?? "?"}`,
			`counts: ${JSON.stringify(this.counts ?? {})}`,
			`rate limit: ${JSON.stringify(this.health?.rate_limit ?? {})}`,
			`degraded: ${JSON.stringify(this.degraded ?? {})}`,
			`subscriptions: items=${this.connected?.items ?? !1} stats=${this.connected?.stats ?? !1}`,
			...e.map((e) => `issue ${e.code} ×${e.count}: ${e.message}`)
		].join("\n");
	}
	render() {
		if (!this.open) return null;
		let e = this._zBase || 9998, t = this.health, n = t?.rate_limit, r = Lr(t?.issues), i = this.degraded, a = !!this.connected?.items && !i?.connectionLost, o = !!i?.rateLimited || !!(n?.dropped_commands || n?.dropped_events), s = t ? !t.healthy : !1, c = s || o || !a;
		return v`
      <div class="backdrop" role="presentation" style="z-index:${e}" @click=${this._close}></div>
      <div class="wrap" role="none" style="z-index:${e + 1}">
        <div
          class="panel"
          role="dialog"
          aria-modal="true"
          aria-label="Diagnostics"
          data-testid="diagnostics-panel"
          @keydown=${A(() => this._close())}
        >
          <div class="head">
            <span style="color: var(--hv-${c ? "warn" : "success"})">
              ${j(c ? "alert" : "checkCircle", 20)}
            </span>
            <h2>Diagnostics</h2>
            <button
              class="hv-pill outline"
              data-testid="health-refresh"
              ?disabled=${this.busy}
              @click=${() => this.dispatchEvent(new CustomEvent("refresh", {
			bubbles: !0,
			composed: !0
		}))}
            >
              ${j("refresh", 15)}${this.busy ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div class="body">
            <div class="status ${c ? "bad" : "ok"}" data-testid="diagnostics-status">
              <span class="dot"></span>
              <span>
                ${a ? o ? v`<strong>Degraded</strong> — rate limiting is active. Some commands and live updates
                        are being dropped.` : s ? v`<strong>Issues found</strong> — the integration reported problems with its stored
                          data.` : v`<strong>No issues</strong> · live` : v`<strong>Not live</strong> — subscriptions are down, so the list only changes when you
                      refresh.`}
              </span>
            </div>

            <div class="tiles">
              <div class="tile">
                <div class="value ${n?.dropped_commands ? "bad" : ""}" data-testid="diagnostics-dropped-commands">
                  ${n?.dropped_commands ?? 0}
                </div>
                <div class="label">Commands rejected</div>
              </div>
              <div class="tile">
                <div class="value ${n?.dropped_events ? "warn" : ""}" data-testid="diagnostics-dropped-events">
                  ${n?.dropped_events ?? 0}
                </div>
                <div class="label">Events dropped</div>
              </div>
              <div class="tile">
                <div class="value" data-testid="diagnostics-since">
                  ${this.lastRefresh ? bn(this.lastRefresh) : "—"}
                </div>
                <div class="label">Since last refresh</div>
              </div>
            </div>

            ${r.length ? v`<div style="display:grid;gap:8px">
                  <span class="hv-label">Issues</span>
                  ${r.map((e) => v`<div class="issue" data-testid="diagnostics-issue" data-code=${e.code}>
                      <span class="glyph">${j("alert", 17)}</span>
                      <span>${e.message}</span>
                    </div>`)}
                </div>` : null}

            <div class="facts">
              <div class="fact">
                <span>Subscriptions</span>
                <span class="value ${a ? "live" : "stale"}" data-testid="diagnostics-subscriptions">
                  ${a ? "items · locations · stats — live" : "not connected"}
                </span>
              </div>
              <div class="fact">
                <span>Data loaded</span>
                <span class="value" data-testid="diagnostics-loaded">
                  ${this.loadedItems} of
                  ${this.counts ? P(this.counts.items_total, "item") : "? items"} ·
                  ${this.counts ? P(this.counts.locations_total, "location") : "? locations"}
                </span>
              </div>
              <div class="fact">
                <span>Rate limiting</span>
                <span class="value">${n?.enabled ? "enabled" : "off"}</span>
              </div>
              <div class="fact">
                <span>Integration version</span>
                <span class="value" data-testid="diagnostics-version">
                  ${this.version?.integration_version ?? "—"}
                </span>
              </div>
            </div>

            ${r.length ? null : v`<span class="note">
                  A healthy integration reports nothing here. The counters stay at zero unless rate limiting is
                  enabled and tripped.
                </span>`}
          </div>

          <div class="foot">
            <span class="spacer"></span>
            <button
              class="hv-text-button"
              data-testid="diagnostics-copy"
              @click=${() => {
			navigator.clipboard?.writeText?.(this.report).catch(() => void 0), this._copied = !0;
		}}
            >
              ${this._copied ? "Copied" : "Copy report"}
            </button>
            <button class="primary" data-testid="diagnostics-close" @click=${this._close}>Close</button>
          </div>
        </div>
      </div>
    `;
	}
}, Rr.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
      }
      /*
       * The single implicit track of a centring grid is auto-sized, and an
       * auto track takes the width its item asks for — 470px — however narrow
       * the container is. The panel's own max-width: 100% then resolved
       * against that 470px track and never clamped, so on a 390px screen the
       * dialog stayed 470 wide: the third tile, the fact values and the Close
       * button all hung off the right edge, unreachable (the wrap measured
       * scrollWidth 494 against clientWidth 390).
       *
       * A minmax(0, 1fr) track is the container's width instead, which is what
       * gives the percentage something to bite on. Rows get the same treatment
       * so a panel with several issues in it scrolls its body rather than
       * growing past the top and bottom edges.
       */
      .wrap {
        position: fixed;
        inset: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
        place-items: center;
        padding: 16px;
        box-sizing: border-box;
      }
      .panel {
        width: 470px;
        max-width: 100%;
        max-height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: var(--hv-radius-dialog);
        box-shadow: var(--hv-shadow-dialog);
        overflow: hidden;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 15px 20px 12px;
        border-bottom: 1px solid var(--hv-row-divider);
      }
      .head h2 {
        margin: 0;
        flex: 1;
        font-size: 17px;
        font-weight: 500;
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 14px 20px;
        display: grid;
        gap: 14px;
      }
      .status {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 11px 13px;
        border-radius: var(--hv-radius-input);
        font-size: 13px;
        line-height: 1.45;
      }
      .status.ok {
        background: var(--hv-primary-tint);
        color: var(--hv-success);
      }
      .status.bad {
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
      }
      .dot {
        flex: none;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: currentColor;
      }
      /* Three fixed columns fit 470px. Once the panel is allowed to be as
         narrow as the screen, three tiles of "Commands rejected" width no
         longer do, so they wrap to two rows instead of overflowing. */
      .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
        gap: 10px;
      }
      .tile {
        border: 1px solid var(--hv-divider);
        border-radius: 10px;
        padding: 11px 13px;
      }
      .tile .value {
        font-size: 21px;
        font-weight: 500;
      }
      .tile .value.bad {
        color: var(--hv-error);
      }
      .tile .value.warn {
        color: var(--hv-warn);
      }
      .tile .label {
        font-size: 11.5px;
        color: var(--hv-text-secondary);
      }
      .issue {
        display: flex;
        gap: 9px;
        padding: 10px 12px;
        border: 1px solid var(--hv-warn-border);
        background: var(--hv-warn-bg);
        border-radius: 8px;
        font-size: 12.5px;
        color: var(--hv-warn-deep);
        line-height: 1.45;
      }
      .issue .glyph {
        color: var(--hv-warn);
        flex: none;
      }
      .facts {
        display: grid;
        gap: 1px;
        background: var(--hv-row-divider);
        border: 1px solid var(--hv-row-divider);
        border-radius: 8px;
        overflow: hidden;
      }
      .fact {
        display: flex;
        padding: 9px 12px;
        background: var(--hv-surface);
        font-size: 12.5px;
        color: var(--hv-text-secondary);
      }
      .fact .value {
        margin-left: auto;
        color: var(--hv-text);
      }
      .fact .value.live {
        color: var(--hv-success);
        font-weight: 500;
      }
      .fact .value.stale {
        color: var(--hv-warn);
        font-weight: 500;
      }
      .note {
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
        line-height: 1.5;
      }
      .foot {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 16px 16px;
      }
      .foot .spacer {
        margin-left: auto;
      }
      .primary {
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        padding: 9px 20px;
        font: 500 13.5px var(--hv-font);
      }
    `
], Rr);
N([E({
	type: Boolean,
	reflect: !0
})], Z.prototype, "open", void 0), N([E({ attribute: !1 })], Z.prototype, "health", void 0), N([E({ attribute: !1 })], Z.prototype, "counts", void 0), N([E({ attribute: !1 })], Z.prototype, "version", void 0), N([E({ attribute: !1 })], Z.prototype, "degraded", void 0), N([E({ attribute: !1 })], Z.prototype, "connected", void 0), N([E({ type: Number })], Z.prototype, "loadedItems", void 0), N([E({ type: String })], Z.prototype, "lastRefresh", void 0), N([E({ type: Boolean })], Z.prototype, "busy", void 0), N([D()], Z.prototype, "_zBase", void 0), N([D()], Z.prototype, "_copied", void 0), Z = N([T("hv-diagnostics-panel")], Z);
//#endregion
//#region src/components/hv-import-sheet.ts
var zr, Br = [
	{
		id: "merge",
		title: "Merge",
		description: "Update items matched by id field by field, combining tags; add the rest"
	},
	{
		id: "replace",
		title: "Replace",
		description: "Overwrite items matched by id with the file's version; add the rest"
	},
	{
		id: "skip",
		title: "Skip",
		description: "Only add items whose id isn't in the inventory yet; leave matched items as they are"
	}
], Q = (zr = class extends b {
	constructor(...e) {
		super(...e), this.open = !1, this.preview = null, this.summary = null, this.busy = !1, this.errorMessage = null, this._source = "paste", this._text = "", this._fileName = null, this._policy = "merge", this._parseError = null, this._zBase = 0, this._copied = !1, this._dialogFocus = new Zt(), this._close = () => {
			this.open = !1, this.dispatchEvent(new CustomEvent("cancel", {
				bubbles: !0,
				composed: !0
			}));
		};
	}
	updated() {
		this._dialogFocus.sync(this.open, () => this.renderRoot.querySelector("[data-testid=\"import-sheet\"]"));
	}
	willUpdate(e) {
		e.has("open") && this.open && (this._zBase = M(), this._source = "paste", this._text = "", this._fileName = null, this._policy = "merge", this._parseError = null, this._copied = !1);
	}
	_parsed() {
		try {
			let e = JSON.parse(this._text);
			return this._parseError = null, e;
		} catch (e) {
			return this._parseError = `That is not valid JSON — ${e.message}`, null;
		}
	}
	_emit(e) {
		let t = this._parsed();
		t !== null && this.dispatchEvent(new CustomEvent(e, {
			detail: {
				document: t,
				policy: this._policy
			},
			bubbles: !0,
			composed: !0
		}));
	}
	async _onFile(e) {
		let t = e.target.files?.[0];
		t && (this._fileName = t.name, this._text = await t.text(), this._parseError = null);
	}
	_copyErrors() {
		let e = (this.preview?.errors ?? []).map((e) => `${e.path}: ${e.message}`).join("\n");
		navigator.clipboard?.writeText?.(e).catch(() => void 0), this._copied = !0;
	}
	_renderInput() {
		return v`
      <div class="head">
        <div class="row"><h2>Import backup</h2></div>
        <div class="sub">Step 1 of 2 · nothing is written until you press Import</div>
      </div>
      <div class="body">
        <div class="tabs" role="tablist">
          ${["paste", "file"].map((e) => v`<button
              class=${this._source === e ? "on" : ""}
              role="tab"
              aria-selected=${String(this._source === e)}
              data-testid="import-source"
              data-source=${e}
              @click=${() => {
			this._source = e;
		}}
            >
              ${e === "paste" ? "Paste JSON" : "Choose file"}
            </button>`)}
        </div>
        ${this._source === "file" ? v`<div class="file-row">
              <label class="hv-pill outline">
                ${j("upload", 15)} Choose file…
                <input class="reveal" type="file" accept="application/json,.json" data-testid="import-file" @change=${(e) => void this._onFile(e)} />
              </label>
              <span data-testid="import-filename" style="font-size:12.5px;color:var(--hv-text-secondary)">
                ${this._fileName ?? "No file chosen"}
              </span>
            </div>` : null}
        <textarea
          data-testid="import-text"
          aria-label="Backup JSON"
          placeholder='{ "haventory_export_version": 1, … }'
          .value=${this._text}
          @input=${(e) => {
			this._text = e.target.value, this._parseError = null;
		}}
        ></textarea>
        ${this._parseError ? v`<div class="alert warn" role="alert" data-testid="import-parse-error">
              <span class="glyph">${j("alert", 18)}</span><span>${this._parseError}</span>
            </div>` : null}
        ${this.errorMessage ? v`<div class="alert warn" role="alert" data-testid="import-error">
              <span class="glyph">${j("alertCircle", 18)}</span><span>${this.errorMessage}</span>
            </div>` : null}

        <div>
          <span class="hv-label">If an item already exists</span>
          <div class="policies" role="radiogroup" style="margin-top:6px" data-testid="import-policies">
            ${Br.map((e) => v`<button
                class="policy ${this._policy === e.id ? "on" : ""}"
                role="radio"
                aria-checked=${String(this._policy === e.id)}
                data-testid="import-policy"
                data-policy=${e.id}
                @click=${() => {
			this._policy = e.id, this.dispatchEvent(new CustomEvent("invalidate-preview", {
				bubbles: !0,
				composed: !0
			}));
		}}
              >
                <span class="radio"></span>
                <span>
                  <span class="title">${e.title}</span>
                  <span class="desc" style="display:block">${e.description}</span>
                </span>
              </button>`)}
          </div>
        </div>
      </div>
      <div class="foot">
        <span class="hint">Import applies for every connected client</span>
        <button class="hv-text-button" data-testid="import-cancel" @click=${this._close}>Cancel</button>
        <button
          class="primary"
          data-testid="import-preview"
          ?disabled=${!this._text.trim() || this.busy}
          @click=${() => this._emit("preview")}
        >
          ${this.busy ? "Checking…" : "Preview"}
        </button>
      </div>
    `;
	}
	_countTable(e, t) {
		return v`<div class="table">
      <div class="caption">${e}</div>
      <div class="rows">
        ${[
			[
				"Add",
				"add",
				"add"
			],
			[
				"Update",
				"update",
				"update"
			],
			[
				"Conflict",
				"conflict",
				"conflict"
			],
			[
				"Unchanged",
				"unchanged",
				"unchanged"
			]
		].map(([n, r, i]) => v`<div class="r ${i}" data-testid="import-count" data-key=${`${e.toLowerCase()}-${r}`}>
            <span>${n}</span><span>${r === "add" ? "+" : ""}${t?.[r] ?? 0}</span>
          </div>`)}
      </div>
    </div>`;
	}
	_renderInvalid(e) {
		return v`
      <div class="head">
        <div class="row">
          <span style="color:var(--hv-error)">${j("alertCircle", 20)}</span>
          <h2>This file can't be imported</h2>
        </div>
        <div class="sub">
          ${P(e.errors.length, "problem")} found · nothing was changed
        </div>
      </div>
      <div class="body">
        <div class="errors" data-testid="import-errors">
          ${e.errors.map((e) => v`<div class="error" data-testid="import-error-row">
              <div class="path">${e.path}</div>
              <div class="msg">${e.message}</div>
            </div>`)}
        </div>
      </div>
      <div class="foot">
        <span class="hint">Fix the file and preview again</span>
        <button class="hv-text-button" data-testid="import-copy-errors" @click=${() => this._copyErrors()}>
          ${this._copied ? "Copied" : "Copy errors"}
        </button>
        <button
          class="primary"
          data-testid="import-back"
          @click=${() => this.dispatchEvent(new CustomEvent("invalidate-preview", {
			bubbles: !0,
			composed: !0
		}))}
        >
          Back to input
        </button>
      </div>
    `;
	}
	_renderPreview(e) {
		let t = e.counts.items, n = e.counts.locations, r = e.items.conflict.length + e.locations.conflict.length, i = (t?.add ?? 0) + (t?.update ?? 0);
		return v`
      <div class="head">
        <div class="row"><h2>Import backup · preview</h2></div>
        <div class="sub">
          Step 2 of 2 · validated on the server, nothing written yet · policy
          <strong style="color:var(--hv-text)">${e.policy}</strong>
        </div>
      </div>
      <div class="body">
        <div class="tables">${this._countTable("Items", t)}${this._countTable("Locations", n)}</div>
        ${r ? v`<div class="alert warn" data-testid="import-conflicts">
              <span class="glyph">${j("alert", 18)}</span>
              <span>
                ${P(r, "conflict")} — the file and this inventory both changed
                ${r === 1 ? "that entry" : "those entries"}.
                ${e.policy === "merge" ? "Merge keeps the file's values." : e.policy === "skip" ? "Skip leaves them as they are." : "Replace overwrites them."}
              </span>
            </div>` : null}
        ${this.errorMessage ? v`<div class="alert warn" role="alert" data-testid="import-error">
              <span class="glyph">${j("alertCircle", 18)}</span><span>${this.errorMessage}</span>
            </div>` : null}
        <div class="fine">
          Import is all-or-nothing: any failure rolls the whole document back. On success every connected card
          reloads its data.
        </div>
      </div>
      <div class="foot">
        <button
          class="hv-text-button"
          data-testid="import-back"
          @click=${() => this.dispatchEvent(new CustomEvent("invalidate-preview", {
			bubbles: !0,
			composed: !0
		}))}
        >
          Back
        </button>
        <span class="hint"></span>
        <button class="hv-text-button" data-testid="import-cancel" @click=${this._close}>Cancel</button>
        <button
          class="primary"
          data-testid="import-execute"
          ?disabled=${this.busy}
          @click=${() => this._emit("execute")}
        >
          ${this.busy ? "Importing…" : `Import ${t?.add ?? 0} + ${t?.update ?? 0}`}
        </button>
      </div>
      ${i === 0 ? v`<div class="foot" style="padding-top:0">
            <span class="hint" data-testid="import-nothing-to-do">
              Nothing in this file would change the inventory
            </span>
          </div>` : null}
    `;
	}
	_renderSummary(e) {
		return v`
      <div class="head">
        <div class="row">
          <span style="color:var(--hv-success)">${j("checkCircle", 20)}</span>
          <h2>Import complete</h2>
        </div>
      </div>
      <div class="body">
        <div class="alert ok" data-testid="import-summary">
          <span class="glyph">${j("checkCircle", 18)}</span>
          <span>
            Imported ${e.items.add} new, updated ${e.items.update},
            ${P(e.locations.add, "location")} added.
          </span>
        </div>
        <div class="fine">
          The inventory now holds ${P(e.totals.items_total, "item")} across
          ${P(e.totals.locations_total, "location")}. Every connected card has reloaded.
        </div>
      </div>
      <div class="foot">
        <span class="hint"></span>
        <button class="primary" data-testid="import-done" @click=${this._close}>Done</button>
      </div>
    `;
	}
	render() {
		if (!this.open) return null;
		let e = this._zBase || 9998, t = this.summary ? this._renderSummary(this.summary) : this.preview && !this.preview.valid ? this._renderInvalid(this.preview) : this.preview ? this._renderPreview(this.preview) : this._renderInput();
		return v`
      <div class="backdrop" role="presentation" style="z-index:${e}" @click=${this._close}></div>
      <div class="wrap" role="none" style="z-index:${e + 1}">
        <div
          class="panel"
          role="dialog"
          aria-modal="true"
          aria-label="Import backup"
          data-testid="import-sheet"
          @keydown=${A(() => this._close())}
        >
          ${t}
        </div>
      </div>
    `;
	}
}, zr.styles = [
	O,
	k,
	o`
      :host {
        display: block;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
      }
      .wrap {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        box-sizing: border-box;
      }
      .panel {
        width: 500px;
        max-width: 100%;
        max-height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: var(--hv-radius-dialog);
        box-shadow: var(--hv-shadow-dialog);
        overflow: hidden;
      }
      .head {
        padding: 16px 20px 12px;
        border-bottom: 1px solid var(--hv-row-divider);
      }
      .head .row {
        display: flex;
        align-items: center;
        gap: 9px;
      }
      .head h2 {
        margin: 0;
        flex: 1;
        font-size: 17px;
        font-weight: 500;
      }
      .head .sub {
        font-size: 12.5px;
        color: var(--hv-text-secondary);
        margin-top: 3px;
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 16px 20px;
        display: grid;
        gap: 14px;
      }
      .tabs {
        display: flex;
        gap: 16px;
      }
      .tabs button {
        border: none;
        background: none;
        padding: 0 4px 7px;
        font: 400 13px var(--hv-font);
        color: var(--hv-text-secondary);
        border-bottom: 2px solid transparent;
      }
      .tabs button.on {
        color: var(--hv-primary-darker);
        font-weight: 500;
        border-bottom-color: var(--hv-primary);
      }
      textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: 132px;
        resize: vertical;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        background: var(--hv-input-bg);
        color: var(--hv-text);
        padding: 12px;
        font: 400 11.5px/1.6 ui-monospace, Menlo, monospace;
      }
      .policies {
        display: grid;
        gap: 8px;
      }
      .policy {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        background: none;
        text-align: left;
        color: inherit;
      }
      .policy.on {
        border-color: var(--hv-primary);
        background: var(--hv-primary-tint);
      }
      .radio {
        flex: none;
        width: 17px;
        height: 17px;
        border-radius: 50%;
        border: 1.5px solid var(--hv-text-tertiary);
        margin-top: 1px;
      }
      .policy.on .radio {
        border: 5px solid var(--hv-primary);
        background: var(--hv-surface);
      }
      .policy .title {
        font: 500 13.5px var(--hv-font);
      }
      .policy .desc {
        font-size: 12px;
        color: var(--hv-text-secondary);
        line-height: 1.45;
      }
      .tables {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .table {
        border: 1px solid var(--hv-divider);
        border-radius: 10px;
        overflow: hidden;
      }
      .table .caption {
        padding: 8px 12px;
        background: var(--hv-input-bg);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--hv-text-secondary);
      }
      .table .rows {
        display: grid;
        gap: 1px;
        background: var(--hv-row-divider);
      }
      .table .r {
        display: flex;
        padding: 8px 12px;
        background: var(--hv-surface);
        font-size: 13px;
      }
      .table .r span:last-child {
        margin-left: auto;
        font-weight: 500;
      }
      .table .r.add span:last-child {
        color: var(--hv-success);
      }
      .table .r.update span:last-child {
        color: var(--hv-primary-darker);
      }
      .table .r.conflict span:last-child {
        color: var(--hv-warn);
      }
      .table .r.unchanged {
        color: var(--hv-text-secondary);
      }
      .table .r.unchanged span:last-child {
        font-weight: 400;
      }
      .alert {
        display: flex;
        gap: 9px;
        padding: 11px 13px;
        border-radius: var(--hv-radius-input);
        font-size: 12.5px;
        line-height: 1.5;
      }
      .alert.warn {
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
      }
      .alert.warn .glyph {
        color: var(--hv-warn);
      }
      .alert.ok {
        background: var(--hv-primary-tint);
        color: var(--hv-success);
      }
      .fine {
        font-size: 12px;
        color: var(--hv-text-tertiary);
        line-height: 1.5;
      }
      .errors {
        display: grid;
        gap: 1px;
        background: var(--hv-row-divider);
        border: 1px solid var(--hv-row-divider);
        border-radius: 8px;
        overflow: hidden;
      }
      .error {
        padding: 10px 14px;
        background: var(--hv-surface);
      }
      .error .path {
        font: 400 11.5px ui-monospace, Menlo, monospace;
        color: var(--hv-primary-darker);
      }
      .error .msg {
        font-size: 12.5px;
        color: var(--hv-error);
        line-height: 1.45;
      }
      .foot {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 16px 16px;
      }
      .foot .hint {
        font-size: 12px;
        color: var(--hv-text-tertiary);
        margin-right: auto;
      }
      .primary {
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        padding: 9px 20px;
        font: 500 13.5px var(--hv-font);
      }
      .primary[disabled] {
        opacity: 0.5;
      }
      .reveal {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
      }
      .file-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
    `
], zr);
N([E({
	type: Boolean,
	reflect: !0
})], Q.prototype, "open", void 0), N([E({ attribute: !1 })], Q.prototype, "preview", void 0), N([E({ attribute: !1 })], Q.prototype, "summary", void 0), N([E({ type: Boolean })], Q.prototype, "busy", void 0), N([E({ type: String })], Q.prototype, "errorMessage", void 0), N([D()], Q.prototype, "_source", void 0), N([D()], Q.prototype, "_text", void 0), N([D()], Q.prototype, "_fileName", void 0), N([D()], Q.prototype, "_policy", void 0), N([D()], Q.prototype, "_parseError", void 0), N([D()], Q.prototype, "_zBase", void 0), N([D()], Q.prototype, "_copied", void 0), Q = N([T("hv-import-sheet")], Q);
//#endregion
//#region src/components/hv-card-shell.ts
var Vr, Hr = 200, Ur = "haventory:filter-panel-open:v1", $ = (Vr = class extends b {
	constructor(...e) {
		super(...e), this.heading = "Inventory", this.forceMobile = null, this.columns = [], this._filterPanelOpen = !1, this._filterSheetOpen = !1, this._stagedCount = null, this._stagedFilters = null, this._confirm = null, this._searchDraft = "", this._editing = null, this._editorBusy = !1, this._editorError = null, this._detailItemId = null, this._fullViewOpen = !1, this._startSelecting = !1, this._organizeOpen = !1, this._organizeTab = "locations", this._diagnosticsOpen = !1, this._importOpen = !1, this._importPreview = null, this._importSummary = null, this._importBusy = !1, this._importError = null, this._refreshBusy = !1, this._lastRefresh = null, this._checkout = null, this.responsive = new tn(this), this._emitSearch = nn((e) => this.store?.setFilters({ q: e }), Hr), this._toggleFilterSurface = () => {
			if (this.mobile) {
				this._filterSheetOpen = !this._filterSheetOpen, this._stagedFilters = this._filterSheetOpen ? this.st?.filters ?? x() : null, this._filterSheetOpen && this._priceStaged(this.st?.filters ?? x());
				return;
			}
			this._filterPanelOpen = !this._filterPanelOpen, Gr(this._filterPanelOpen);
		}, this._priceStaged = nn((e) => {
			this.store?.countMatching(e).then((e) => {
				this._stagedCount = e;
			});
		}, 150), this._onEditorSave = async (e) => {
			let t = e.detail;
			this._editorBusy = !0, this._editorError = null;
			let n = this.st?.errorQueue.length ?? 0;
			try {
				t.itemId && t.changes ? await this.store?.updateItem(t.itemId, t.changes, t.expectedVersion) : t.create && await this.store?.createItem(t.create);
			} finally {
				this._editorBusy = !1;
			}
			(this.st?.errorQueue.length ?? 0) > n || (this._editing = null);
		}, this._onEditorDelete = (e) => {
			let { itemId: t } = e.detail, n = this._itemById(t);
			n && this._requestDelete(n);
		}, this._renderEditor = (e, t = {}) => {
			let n = this.st;
			return v`<hv-item-editor
      data-testid="inline-editor"
      ?noHeader=${t.noHeader ?? !1}
      .item=${e ? this._itemById(e) ?? null : null}
      .locations=${n?.locationsFlatCache ?? null}
      .locationTree=${n?.locationTreeCache ?? []}
      .categorySuggestions=${(n?.distinctValuesCache?.categories ?? []).map((e) => e.value)}
      .tagSuggestions=${(n?.distinctValuesCache?.tags ?? []).map((e) => e.value)}
      .customFieldKeys=${n?.distinctValuesCache?.custom_field_keys ?? []}
      ?mobile=${this.mobile}
      .busy=${this._editorBusy}
      .errorMessage=${this._editorError}
      @save=${this._onEditorSave}
      @delete-item=${this._onEditorDelete}
      @cancel=${() => {
				this._editing = null, this._editorError = null;
			}}
    ></hv-item-editor>`;
		}, this._onRowEvent = (e, t) => {
			let n = this._itemById(t.itemId);
			if (n) switch (e) {
				case "increment":
					this._adjust(n.id, 1);
					break;
				case "decrement":
					n.quantity > 0 && this._adjust(n.id, -1);
					break;
				case "check-in":
					this.store?.markCheckedIn(n.id, n.version);
					break;
				case "request-delete":
					this._requestDelete(n);
					break;
				case "row-action":
					this._onRowAction(n, t);
					break;
				case "edit":
				case "open-item":
					this.mobile ? this._detailItemId = n.id : this._startEdit(n.id);
					break;
				default: this.dispatchEvent(new CustomEvent(e, {
					detail: { itemId: n.id },
					bubbles: !0,
					composed: !0
				}));
			}
		}, this._onMenuSelect = (e) => {
			e.stopPropagation();
			let { id: t, tab: n } = e.detail;
			this._runMenuAction(t, n);
		}, this._onEmptyAction = (e) => {
			let { id: t } = e.detail;
			t === "clear-filters" ? this.store?.clearFilters() : t === "refresh" ? this.store?.refreshAll() : t === "add-item" ? this._startEdit("new") : this._runMenuAction(t);
		};
	}
	get mobile() {
		return this.responsive.mobile;
	}
	get st() {
		return this.store?.state.value ?? null;
	}
	connectedCallback() {
		super.connectedCallback(), this._filterPanelOpen = Wr(), this.store && !this._storeUnsub && (this._storeUnsub = this.store.state.onChange(() => this.requestUpdate()));
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._storeUnsub?.(), this._storeUnsub = void 0;
	}
	willUpdate(e) {
		e.has("store") && this.store && (this._storeUnsub?.(), this._storeUnsub = this.store.state.onChange(() => this.requestUpdate()), this._searchDraft = this.store.state.value.filters.q), e.has("forceMobile") && this.responsive.setForced(this.forceMobile), this.toggleAttribute("mobile", this.mobile);
	}
	updated() {
		this.toggleAttribute("mobile", this.mobile);
	}
	_setFilters(e) {
		this.store?.setFilters(e);
	}
	_adjust(e, t) {
		this.store?.adjustQuantity(e, t);
	}
	_requestDelete(e) {
		this._confirm = {
			heading: `Delete "${e.name}"?`,
			message: "This cannot be undone. The item is removed for every connected client.",
			confirmLabel: "Delete",
			destructive: !0,
			onConfirm: () => {
				this._editing === e.id && (this._editing = null), this._detailItemId === e.id && (this._detailItemId = null), this.store?.deleteItem(e.id, e.version);
			}
		};
	}
	_itemById(e) {
		return this.st?.items.find((t) => t.id === e);
	}
	_onRowAction(e, t) {
		switch (t.action) {
			case "check-out":
				this._checkout = {
					itemId: e.id,
					mode: "check-out",
					anchor: t.anchor ?? null
				};
				break;
			case "set-due-date":
				this._checkout = {
					itemId: e.id,
					mode: "set-due-date",
					anchor: t.anchor ?? null
				};
				break;
			case "check-in":
				this.store?.markCheckedIn(e.id, e.version);
				break;
			case "edit":
				this._startEdit(e.id);
				break;
			case "delete":
				this._requestDelete(e);
				break;
		}
	}
	get _editor() {
		let e = this.shadowRoot?.querySelector("hv-list");
		return this.shadowRoot?.querySelector("hv-item-editor") ?? e?.shadowRoot?.querySelector("hv-item-editor") ?? null;
	}
	_startEdit(e) {
		if (this._editing !== e) {
			if (this._editing !== null && this._editor?.dirty) {
				this._confirm = {
					heading: "Discard your changes?",
					message: "The item you are editing has unsaved changes.",
					confirmLabel: "Discard",
					destructive: !0,
					onConfirm: () => {
						this._editorError = null, this._editing = e;
					}
				};
				return;
			}
			this._editorError = null, this._editing = e;
		}
	}
	get diagnosticsBadge() {
		let e = this.st;
		if (!e) return null;
		let t = e.healthCache?.rate_limit, n = (t?.dropped_commands ?? 0) + (t?.dropped_events ?? 0);
		if (n > 0) return `${n} dropped`;
		let r = e.healthCache?.issues.length ?? 0;
		return r > 0 ? P(r, "issue") : e.degraded.connectionLost ? "offline" : null;
	}
	async _refresh() {
		this._refreshBusy = !0;
		try {
			await this.store?.refreshAll(), this._lastRefresh = (/* @__PURE__ */ new Date()).toISOString();
		} finally {
			this._refreshBusy = !1;
		}
	}
	async _onImportPreview(e) {
		let { document: t, policy: n } = e.detail;
		this._importBusy = !0, this._importError = null, this._importSummary = null;
		try {
			this._importPreview = await this.store?.previewImport(t, n) ?? null;
		} catch (e) {
			this._importPreview = null, this._importError = e?.message ?? "Could not check that document.";
		} finally {
			this._importBusy = !1;
		}
	}
	async _onImportExecute(e) {
		let { document: t, policy: n } = e.detail;
		this._importBusy = !0, this._importError = null;
		try {
			this._importSummary = await this.store?.executeImport(t, n) ?? null, this._lastRefresh = (/* @__PURE__ */ new Date()).toISOString();
		} catch (e) {
			let t = e;
			t?.code === "validation_error" && t.data?.errors?.length ? this._importPreview = {
				valid: !1,
				errors: t.data.errors,
				policy: n,
				document: {
					haventory_export_version: null,
					schema_version: null,
					exported_at: null,
					integration_version: null
				},
				items: {
					add: [],
					update: [],
					conflict: [],
					unchanged: []
				},
				locations: {
					add: [],
					update: [],
					conflict: [],
					unchanged: []
				},
				counts: {}
			} : this._importError = t?.message ?? "The import failed.";
		} finally {
			this._importBusy = !1;
		}
	}
	get menuEntries() {
		let e = this.st, t = e?.statsCounts?.items_total ?? null, n = e?.total ?? null, r = S(e?.filters ?? x()) > 0;
		return [
			{
				id: "select-items",
				label: "Select items…",
				glyph: "select"
			},
			{
				id: "organize",
				label: "Organize…",
				glyph: "mapMarker",
				meta: "Locations · Tags · Categories"
			},
			{
				id: "columns",
				label: "Columns…",
				glyph: "viewColumn"
			},
			{ divider: !0 },
			{
				id: "refresh",
				label: "Refresh data",
				glyph: "refresh",
				meta: "Items · locations · stats"
			},
			{
				id: "diagnostics",
				label: "Diagnostics",
				glyph: "alertCircle",
				...this.diagnosticsBadge ? { badge: this.diagnosticsBadge } : {}
			},
			{ divider: !0 },
			{ caption: "Data" },
			{
				id: "export-all",
				label: "Export backup",
				glyph: "download",
				sub: t === null ? "Everything" : `All ${P(t, "item")} · all locations`
			},
			{
				id: "export-view",
				label: "Export current view",
				glyph: "download",
				sub: n === null ? "Active filter · keeps location paths" : `${n} filtered ${en(n, "item")} · keeps location paths`,
				disabled: !r
			},
			{
				id: "import",
				label: "Import backup…",
				glyph: "upload"
			}
		];
	}
	get cardMenuEntries() {
		return this.menuEntries.filter((e) => !("id" in e && e.id === "columns"));
	}
	_runMenuAction(e, t) {
		if (e === "refresh") {
			this._refresh();
			return;
		}
		if (e === "diagnostics") {
			this._diagnosticsOpen = !0;
			return;
		}
		if (e === "import") {
			this._importPreview = null, this._importSummary = null, this._importError = null, this._importOpen = !0;
			return;
		}
		if (e === "organize") {
			this._organizeTab = t ?? "locations", this._organizeOpen = !0;
			return;
		}
		if (e === "select-items") {
			this._startSelecting = !0, this._fullViewOpen = !0;
			return;
		}
		this.dispatchEvent(new CustomEvent("menu-action", {
			detail: { id: e },
			bubbles: !0,
			composed: !0
		}));
	}
	_renderBadges() {
		let e = this.st, t = e?.statsCounts;
		if (!t) return null;
		let n = e?.filters;
		return !this.mobile || t.low_stock_count > 0 || (t.overdue_count ?? 0) > 0 || (t.inspection_overdue_count ?? 0) > 0 || t.checked_out_count > 0 ? v`
      <div class="badges">
        ${this.mobile ? null : v`<span class="badge" data-testid="badge-total">${P(t.items_total, "item")}</span>`}
        ${t.low_stock_count > 0 ? v`<button
              class="badge low ${n?.lowStockOnly ? "on" : ""}"
              data-testid="badge-low"
              aria-pressed=${String(!!n?.lowStockOnly)}
              title="Show only low-stock items"
              @click=${() => this._setFilters({ lowStockOnly: !n?.lowStockOnly })}
            >
              ${t.low_stock_count} low
            </button>` : null}
        ${(t.overdue_count ?? 0) > 0 ? v`<button
              class="badge overdue ${n?.overdueOnly ? "on" : ""}"
              data-testid="badge-overdue"
              aria-pressed=${String(!!n?.overdueOnly)}
              title="Show only overdue items"
              @click=${() => this._setFilters({ overdueOnly: !n?.overdueOnly })}
            >
              ${t.overdue_count} overdue
            </button>` : null}
        ${(t.inspection_overdue_count ?? 0) > 0 ? v`<button
              class="badge inspect ${n?.inspectionDueOnly ? "on" : ""}"
              data-testid="badge-inspection"
              aria-pressed=${String(!!n?.inspectionDueOnly)}
              title="Show only items due for inspection"
              @click=${() => this._setFilters({ inspectionDueOnly: !n?.inspectionDueOnly })}
            >
              ${t.inspection_overdue_count} to inspect
            </button>` : null}
        ${t.checked_out_count > 0 ? v`<button
              class="badge out ${n?.checkedOutOnly ? "on" : ""}"
              data-testid="badge-out"
              aria-pressed=${String(!!n?.checkedOutOnly)}
              title="Show only checked-out items"
              @click=${() => this._setFilters({ checkedOutOnly: !n?.checkedOutOnly })}
            >
              ${t.checked_out_count} checked out
            </button>` : null}
      </div>
    ` : null;
	}
	_renderDegradedBanners() {
		let e = this.st?.degraded;
		if (!e) return null;
		let t = [];
		if (e.connectionLost) t.push(v`<hv-banner
        kind="error"
        glyph="wifiOff"
        heading="Connection lost"
        message=" · showing the data already loaded. Changes may not save."
        data-testid="degraded-offline"
      >
        <button
          slot="actions"
          class="hv-pill outline"
          data-testid="degraded-reconnect"
          @click=${() => void this._refresh()}
        >
          Reconnect
        </button>
      </hv-banner>`);
		else if (e.liveUpdates !== "live") {
			let n = e.liveUpdates === "retrying";
			t.push(v`<hv-banner
        kind="warning"
        glyph="clock"
        heading="Live updates paused"
        message=${n ? " · rate limited. Retrying automatically; this list may be out of date until then." : " · rate limited. This list may be out of date until you refresh."}
        data-testid="degraded-live-updates"
      >
        ${n ? null : v`<button
              slot="actions"
              class="hv-pill outline"
              data-testid="degraded-live-refresh"
              @click=${() => void this._refresh()}
            >
              Refresh
            </button>`}
      </hv-banner>`);
		} else e.retrying > 0 ? t.push(v`<hv-banner
        kind="warning"
        glyph="clock"
        heading="Busy — retrying"
        message=${` · ${P(e.retrying, "change")} queued`}
        data-testid="degraded-retrying"
      ></hv-banner>`) : e.rateLimited && t.push(v`<hv-banner
        kind="warning"
        glyph="clock"
        heading="Rate limited"
        message=" · some live updates may have been dropped, so this list can be out of date."
        data-testid="degraded-rate-limited"
      >
        <button
          slot="actions"
          class="hv-pill outline"
          data-testid="degraded-refresh"
          @click=${() => void this._refresh()}
        >
          Refresh
        </button>
      </hv-banner>`);
		return e.reloading && t.push(v`<hv-banner
        kind="info"
        glyph="refresh"
        heading="Inventory was replaced by an import"
        message=" · reloading…"
        data-testid="degraded-reloading"
      ></hv-banner>`), t.length ? v`<div class="banners" data-testid="degraded-banners">${t}</div>` : null;
	}
	_renderBanners() {
		let e = this.st?.errorQueue ?? [];
		return e.length ? v`
      <div class="banners" data-testid="banners">
        ${e.map((e) => {
			let t = e.kind === "conflict" && e.itemId;
			return v`<hv-banner
            kind=${t ? "warning" : "error"}
            .heading=${t ? "Someone else changed this item." : null}
            .message=${e.message}
            data-testid="banner-entry"
            data-code=${e.code}
          >
            ${t ? v`<span slot="below">
                  <button
                    class="hv-pill outline"
                    data-testid="banner-view-latest"
                    @click=${() => {
				this.store?.refreshItem(e.itemId), this.store?.dismissError(e.id);
			}}
                  >
                    View latest
                  </button>
                  ${e.changes ? v`<button
                        class="hv-pill"
                        data-testid="banner-reapply"
                        @click=${() => {
				this.store?.updateItem(e.itemId, e.changes), this.store?.dismissError(e.id);
			}}
                      >
                        Re-apply my change
                      </button>` : null}
                </span>` : null}
            <button
              slot="actions"
              class="hv-icon-button"
              data-testid="banner-dismiss"
              aria-label="Dismiss"
              @click=${() => this.store?.dismissError(e.id)}
            >
              ${j("close", 16)}
            </button>
          </hv-banner>`;
		})}
      </div>
    ` : null;
	}
	_renderFilterPanel(e) {
		let t = this.st;
		return t ? v`<hv-filter-panel
      .filters=${t.filters}
      .distinct=${t.distinctValuesCache}
      .areas=${t.areasCache?.areas ?? []}
      .locations=${t.locationsFlatCache}
      .locationTree=${t.locationTreeCache ?? []}
      .total=${t.total}
      .grandTotal=${t.statsCounts?.items_total ?? null}
      .counts=${t.statsCounts}
      ?mobile=${e}
      @change=${(e) => this._setFilters(e.detail)}
      @stage=${(e) => {
			let t = e.detail.filters;
			this._stagedFilters = t, this._priceStaged(t);
		}}
      @apply=${(e) => {
			this._setFilters(e.detail), this._filterSheetOpen = !1, this._stagedFilters = null;
		}}
      @clear-filters=${() => this.store?.clearFilters()}
    ></hv-filter-panel>` : null;
	}
	render() {
		let e = this.st, t = e?.filters ?? x(), n = S(t), r = S(this._stagedFilters ?? t), i = e?.items.length ?? 0, a = e?.total, o = this.mobile;
		return v`
      <div class="header">
        <h2 class="title" data-testid="card-title">${this.heading}</h2>
        ${this._renderBadges()}
        <button
          class="hv-icon-button expand"
          data-testid="expand-toggle"
          aria-label="Open full view"
          aria-expanded=${String(this._fullViewOpen)}
          title="Open full view"
          @click=${() => {
			this._fullViewOpen = !0;
		}}
        >
          ${j("arrowExpand", 19)}
        </button>
        <button
          class="add ${o ? "round" : ""}"
          data-testid="add-item"
          aria-label="Add item"
          title="Add item"
          @click=${() => this._startEdit("new")}
        >
          ${j("plus", 16)}${o ? null : "Add"}
        </button>
        <hv-overflow-menu
          .entries=${this.cardMenuEntries}
          data-testid="card-overflow"
          @select=${this._onMenuSelect}
        ></hv-overflow-menu>
      </div>

      <div class="search-row">
        <label class="search">
          ${j("magnify", 18)}
          <span class="hv-sr-only">Search items</span>
          <input
            type="search"
            data-testid="search-input"
            placeholder=${a == null ? "Search items…" : `Search ${a} matching ${en(a, "item")}…`}
            .value=${this._searchDraft}
            @input=${(e) => {
			this._searchDraft = e.target.value, this._emitSearch(this._searchDraft);
		}}
          />
        </label>
        <button
          class="icon-toggle ${this._filterPanelOpen || this._filterSheetOpen ? "on" : ""}"
          data-testid="filter-toggle"
          aria-label="Filters"
          aria-expanded=${String(this._filterPanelOpen || this._filterSheetOpen)}
          title="Filters"
          @click=${this._toggleFilterSurface}
        >
          ${j("tune", 19)}
          ${n > 0 ? v`<span class="dot" data-testid="filter-active-dot"></span>` : null}
        </button>
      </div>

      ${n > 0 ? v`<div class="chips-row">
            <hv-filter-chips
              .filters=${t}
              .locations=${e?.locationsFlatCache ?? null}
              .areas=${e?.areasCache?.areas ?? []}
              @remove-filter=${(e) => this._setFilters(e.detail.patch)}
              @clear-filters=${() => this.store?.clearFilters()}
            ></hv-filter-chips>
          </div>` : null}
      ${!o && this._filterPanelOpen ? v`<div class="panel-holder">${this._renderFilterPanel(!1)}</div>` : null}
      ${this._renderDegradedBanners()} ${this._renderBanners()}

      <hv-list
        data-testid="card-list"
        .items=${e?.items ?? []}
        .loading=${e?.loading ?? !0}
        .mobile=${o}
        .editorTemplate=${this._renderEditor}
        .editingItemId=${this._editing === "new" ? null : this._editing}
        .addingNew=${!o && this._editing === "new"}
        .emptyKind=${rn(this.st)}
        .emptyLocationName=${(e?.locationsFlatCache ?? []).find((e) => e.id === t.locationId)?.name ?? null}
        @near-end=${(e) => void this.store?.prefetchIfNeeded(e.detail.ratio)}
        @empty-action=${this._onEmptyAction}
        @increment=${(e) => this._onRowEvent("increment", e.detail)}
        @decrement=${(e) => this._onRowEvent("decrement", e.detail)}
        @check-in=${(e) => this._onRowEvent("check-in", e.detail)}
        @request-delete=${(e) => this._onRowEvent("request-delete", e.detail)}
        @edit=${(e) => this._onRowEvent("edit", e.detail)}
        @open-item=${(e) => this._onRowEvent("open-item", e.detail)}
        @row-action=${(e) => this._onRowEvent("row-action", e.detail)}
      ></hv-list>

      ${i > 0 ? v`<div class="footer">
            <span data-testid="showing-count">
              ${a == null ? `Showing ${i}` : `Showing ${i} of ${a}${n > 0 ? " filtered" : ""}`}
            </span>
            ${o ? null : v`<button
                  class="link"
                  data-testid="open-full-view"
                  @click=${() => {
			this._fullViewOpen = !0;
		}}
                >
                  Open full view${j("openInNew", 15)}
                </button>`}
          </div>` : null}

      <hv-full-view
        data-testid="card-full-view"
        ?open=${this._fullViewOpen}
        .store=${this.store}
        .heading=${this.heading}
        .columns=${this.columns}
        .menuEntries=${this.menuEntries}
        ?startSelecting=${this._startSelecting}
        @close=${() => {
			this._fullViewOpen = !1, this._startSelecting = !1;
		}}
        @menu-action=${this._onMenuSelect}
        @request-delete=${(e) => this._onRowEvent("request-delete", e.detail)}
      ></hv-full-view>
      ${o ? v`<hv-bottom-sheet
            label="Filters"
            ?open=${this._filterSheetOpen}
            data-testid="filter-sheet"
            @cancel=${() => {
			this._filterSheetOpen = !1, this._stagedFilters = null, this._filterPanel?.resetDraft();
		}}
          >
            <div class="sheet-head">
              <span class="heading">Filters</span>
              <span style="font-size:12.5px;color:var(--hv-text-secondary)">${r} active</span>
              <button
                class="link"
                style="margin-left:auto"
                data-testid="sheet-clear-all"
                @click=${() => this._filterPanel?.clearAll()}
              >
                Clear all
              </button>
            </div>
            ${this._renderFilterPanel(!0)}
            <div class="sheet-footer" slot="footer">
              <button
                class="cancel"
                data-testid="sheet-cancel"
                @click=${() => {
			this._filterSheetOpen = !1, this._stagedFilters = null, this._filterPanel?.resetDraft();
		}}
              >
                Cancel
              </button>
              <button
                class="apply"
                data-testid="sheet-apply"
                @click=${() => this._filterPanel?.apply()}
              >
                ${this._stagedCount === null ? "Show items" : `Show ${P(this._stagedCount, "item")}`}
              </button>
            </div>
          </hv-bottom-sheet>` : null}

      ${o ? v`<hv-bottom-sheet
            label="New item"
            ?open=${this._editing === "new"}
            data-testid="add-sheet"
            @cancel=${() => {
			this._editing = null, this._editorError = null;
		}}
          >
            <div class="sheet-head">
              <span class="heading">New item</span>
              <button
                class="hv-icon-button"
                style="margin-left:auto"
                data-testid="add-sheet-close"
                aria-label="Close"
                @click=${() => {
			this._editing = null, this._editorError = null;
		}}
              >
                ${j("close", 18)}
              </button>
            </div>
            ${this._editing === "new" ? this._renderEditor(null, { noHeader: !0 }) : null}
          </hv-bottom-sheet>` : null}

      ${o ? v`<hv-detail-sheet
            data-testid="card-detail-sheet"
            ?open=${this._detailItemId !== null}
            .item=${this._detailItemId ? this._itemById(this._detailItemId) ?? null : null}
            .locations=${e?.locationsFlatCache ?? null}
            .locationTree=${e?.locationTreeCache ?? []}
            .categorySuggestions=${(e?.distinctValuesCache?.categories ?? []).map((e) => e.value)}
            .tagSuggestions=${(e?.distinctValuesCache?.tags ?? []).map((e) => e.value)}
            .customFieldKeys=${e?.distinctValuesCache?.custom_field_keys ?? []}
            .busy=${this._editorBusy}
            .errorMessage=${this._editorError}
            @cancel=${() => {
			this._detailItemId = null, this._editorError = null;
		}}
            @increment=${(e) => this._onRowEvent("increment", e.detail)}
            @decrement=${(e) => this._onRowEvent("decrement", e.detail)}
            @check-in=${(e) => this._onRowEvent("check-in", e.detail)}
            @check-out-confirmed=${(e) => {
			let { itemId: t, dueDate: n } = e.detail, r = this._itemById(t);
			r && this.store?.checkOut(r.id, n, r.version);
		}}
            @set-due-date=${(e) => {
			let { itemId: t, dueDate: n } = e.detail, r = this._itemById(t);
			r && this.store?.updateItem(r.id, { due_date: n }, r.version);
		}}
            @request-delete=${(e) => this._onRowEvent("request-delete", e.detail)}
            @save=${this._onEditorSave}
          ></hv-detail-sheet>` : null}

      <hv-import-sheet
        data-testid="card-import"
        ?open=${this._importOpen}
        .preview=${this._importPreview}
        .summary=${this._importSummary}
        .busy=${this._importBusy}
        .errorMessage=${this._importError}
        @preview=${(e) => void this._onImportPreview(e)}
        @execute=${(e) => void this._onImportExecute(e)}
        @invalidate-preview=${() => {
			this._importPreview = null, this._importError = null;
		}}
        @cancel=${() => {
			this._importOpen = !1, this._importPreview = null, this._importSummary = null, this._importError = null;
		}}
      ></hv-import-sheet>

      <hv-diagnostics-panel
        data-testid="card-diagnostics"
        ?open=${this._diagnosticsOpen}
        .health=${e?.healthCache ?? null}
        .counts=${e?.statsCounts ?? null}
        .version=${e?.versionInfo ?? null}
        .degraded=${e?.degraded ?? null}
        .connected=${e?.connected ?? null}
        .loadedItems=${i}
        .lastRefresh=${this._lastRefresh}
        .busy=${this._refreshBusy}
        @refresh=${() => void this._refresh()}
        @cancel=${() => {
			this._diagnosticsOpen = !1;
		}}
      ></hv-diagnostics-panel>

      <hv-checkout-popover
        data-testid="card-checkout"
        ?open=${this._checkout !== null}
        ?mobile=${o}
        .mode=${this._checkout?.mode ?? "check-out"}
        .anchor=${this._checkout?.anchor ?? null}
        .item=${this._checkout ? this._itemById(this._checkout.itemId) ?? null : null}
        @check-out=${(e) => {
			let { itemId: t, dueDate: n } = e.detail, r = this._itemById(t);
			this._checkout = null, r && this.store?.checkOut(r.id, n, r.version);
		}}
        @set-due-date=${(e) => {
			let { itemId: t, dueDate: n } = e.detail, r = this._itemById(t);
			this._checkout = null, r && this.store?.updateItem(r.id, { due_date: n }, r.version);
		}}
        @cancel=${() => {
			this._checkout = null;
		}}
      ></hv-checkout-popover>

      <hv-organize-dialog
        data-testid="card-organize"
        ?open=${this._organizeOpen}
        ?mobile=${o}
        .tab=${this._organizeTab}
        .store=${this.store}
        @cancel=${() => {
			this._organizeOpen = !1;
		}}
        @browse=${() => {
			this._fullViewOpen = !0;
		}}
      ></hv-organize-dialog>

      <hv-confirm
        data-testid="card-confirm"
        ?open=${this._confirm !== null}
        .heading=${this._confirm?.heading ?? ""}
        .message=${this._confirm?.message ?? ""}
        .confirmLabel=${this._confirm?.confirmLabel ?? "Delete"}
        .destructive=${this._confirm?.destructive ?? !0}
        @confirm=${() => {
			this._confirm?.onConfirm(), this._confirm = null;
		}}
        @cancel=${() => {
			this._confirm = null;
		}}
      ></hv-confirm>
    `;
	}
	get _filterPanel() {
		return this.shadowRoot?.querySelector("hv-filter-panel") ?? null;
	}
}, Vr.styles = [
	O,
	k,
	o`
      :host {
        display: block;
        background: var(--hv-surface);
        color: var(--hv-text);
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-card);
        overflow: hidden;
      }
      /* The ⋮ menu is an absolutely positioned dropdown inside this box, so the
         overflow rule above — which is what keeps the list's rows inside the
         rounded corners — clips it. A card holding few enough items to be shorter
         than the open menu cuts it off at the bottom edge, and the entries it
         loses are the last ones: Export and Import. An empty card is the worst
         case at 269px against a 381px menu.

         Reserving the height the menu needs is what keeps every entry reachable.
         Measured from the card's top edge: 56px of header above the trigger, a
         6px gap, then the menu itself; the remainder covers a second line under
         "Export current view", which the sub-label takes when the filtered count
         is long.

         Only above 600px, matching hv-overflow-menu's own breakpoint: below it
         the menu is a fixed bottom sheet anchored to the viewport, which nothing
         here clips and which would not justify a 470px card on a phone. */
      @media (min-width: 601px) {
        :host {
          min-height: 470px;
        }
      }
      /* Declared once here and inherited into every nested component's shadow
         DOM — the shared .hv-icon-button, the sheets, the row steppers and the
         editor all read it, so none of them needs its own copy of "is the card
         narrow?". It is keyed off the card's measured width rather than a
         pointer:coarse media query, to stay consistent with every other mobile
         affordance in this component. */
      :host([mobile]) {
        --hv-tap-min: 44px;
        /* iOS Safari zooms the whole page when a field smaller than 16px takes
           focus, and never zooms back out. Every field on the card was between
           12.5px and 14.5px, so tapping any of them left the user zoomed in. */
        --hv-input-font: 16px;
      }
      .header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px 10px;
      }
      .title {
        /* Takes the slack so the actions stay right-aligned even before the
           stats badges have loaded. */
        flex: 1;
        min-width: 0;
        font-size: 20px;
        font-weight: 400;
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      :host([mobile]) .title {
        font-size: 19px;
      }
      .badges {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
      }
      /* The title is the only thing in this row that can give, so every badge
         and button that will not shrink comes straight out of its width —
         below ~375px there is none of it left. The badges are filter toggles
         rather than decoration, so on a phone they take a row of their own and
         hand the width back. */
      :host([mobile]) .header {
        flex-wrap: wrap;
      }
      :host([mobile]) .badges {
        order: 1;
        flex-basis: 100%;
        margin-left: 0;
        /* Four of these — low, overdue, to inspect, checked out — with
           five-digit counts will not make one line of a 320px phone. Wrapping
           costs a second 44px band in the worst case; not wrapping pushes the
           last one off the side of the card, where it cannot be pressed at
           all. */
        flex-wrap: wrap;
        row-gap: 6px;
      }
      .badge {
        border: 1px solid var(--hv-divider);
        background: none;
        border-radius: var(--hv-radius-chip);
        padding: 3px 9px;
        font: 500 11px var(--hv-font);
        color: var(--hv-text-secondary);
        white-space: nowrap;
      }
      /* These are filter toggles, not decoration, and on their own row there is
         height to spare — so they take a full tap-height target. */
      :host([mobile]) .badge {
        display: inline-flex;
        align-items: center;
        min-height: var(--hv-tap-min, auto);
        padding: 0 14px;
        font-size: 12.5px;
      }
      .badge.low {
        color: var(--hv-warn);
        background: var(--hv-warn-bg);
        border-color: transparent;
      }
      .badge.out {
        color: var(--hv-primary-darker);
        background: var(--hv-primary-tint);
        border-color: transparent;
      }
      .badge.overdue {
        color: var(--hv-error-deep);
        background: var(--hv-error-bg);
        border-color: transparent;
      }
      /* Amber like low stock rather than red like overdue: red says an item is
         out and late back, amber says something on the shelf wants doing. */
      .badge.inspect {
        color: var(--hv-warn-deep);
        background: var(--hv-warn-bg);
        border-color: transparent;
      }
      .badge.on {
        outline: 2px solid var(--hv-primary);
        outline-offset: 1px;
      }
      .add {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: none;
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        padding: 7px 14px 7px 10px;
        font: 500 13px var(--hv-font);
      }
      .add:hover {
        opacity: 0.9;
      }
      .add.round {
        width: var(--hv-tap-min, 36px);
        height: var(--hv-tap-min, 36px);
        padding: 0;
        border-radius: 50%;
        justify-content: center;
      }
      /* Sits with the other header actions rather than in the search row, where
         a third circle crowded the search box on a narrow card. Outlined like
         the filter button below it: a borderless glyph beside a filled primary
         button reads as decoration rather than something to press. */
      .header .expand {
        width: var(--hv-tap-min, 36px);
        height: var(--hv-tap-min, 36px);
        border: 1px solid var(--hv-divider);
        color: var(--hv-text-secondary);
      }
      .header .expand:hover {
        border-color: var(--hv-primary);
        color: var(--hv-primary-dark);
      }
      .search-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 16px 10px;
      }
      .search {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--hv-input-bg);
        border-radius: var(--hv-radius-chip);
        padding: 8px 14px;
        color: var(--hv-text-secondary);
      }
      .search input {
        flex: 1;
        min-width: 0;
        border: none;
        background: none;
        outline: none;
        font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
        color: var(--hv-text);
      }
      /* The input inside the pill is what actually takes the tap, so the field
         owns the height rather than the pill around it. */
      :host([mobile]) .search {
        padding: 0 14px;
      }
      :host([mobile]) .search input {
        min-height: var(--hv-tap-min, auto);
      }
      .icon-toggle {
        position: relative;
        flex: none;
        display: inline-grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 50%;
        border: 1px solid var(--hv-divider);
        background: none;
        color: var(--hv-text-secondary);
        padding: 0;
      }
      :host([mobile]) .icon-toggle {
        width: var(--hv-tap-min, 40px);
        height: var(--hv-tap-min, 40px);
      }
      .icon-toggle:hover {
        background: var(--hv-hover-overlay);
      }
      .icon-toggle.on {
        border-color: var(--hv-primary);
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
      }
      .icon-toggle .dot {
        position: absolute;
        top: 0;
        right: 0;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--hv-primary);
        border: 1.5px solid var(--hv-surface);
      }
      .chips-row {
        padding: 0 16px 10px;
      }
      .panel-holder {
        margin: 0 16px 12px;
      }
      .banners {
        display: grid;
        gap: 6px;
        padding: 0 16px 10px;
      }
      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 9px 16px;
        border-top: 1px solid var(--hv-row-divider);
        font-size: 12px;
        color: var(--hv-text-tertiary);
      }
      .sheet-footer {
        display: flex;
        gap: 10px;
        padding: 12px 16px 18px;
      }
      .sheet-footer .cancel {
        flex: none;
        min-height: 46px;
        border: 1px solid var(--hv-divider);
        background: none;
        color: var(--hv-chip-text);
        border-radius: var(--hv-radius-chip);
        padding: 0 20px;
        font: 500 14px var(--hv-font);
      }
      .sheet-footer .apply {
        flex: 1;
        min-height: 46px;
        border: none;
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        border-radius: var(--hv-radius-chip);
        font: 500 14.5px var(--hv-font);
      }
      .sheet-head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 16px 10px;
        border-bottom: 1px solid var(--hv-row-divider);
      }
      .sheet-head .heading {
        font-size: 16px;
        font-weight: 500;
        color: var(--hv-text);
      }
      .link {
        border: none;
        background: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font: 500 12.5px var(--hv-font);
        color: var(--hv-primary-dark);
        padding: 0;
      }
      /* A text link in the filter sheet's header is still a control, so it gets
         a tap-sized target. */
      :host([mobile]) .link {
        min-height: var(--hv-tap-min, auto);
        padding: 0 6px;
      }
    `
], Vr);
N([E({ attribute: !1 })], $.prototype, "store", void 0), N([E({ type: String })], $.prototype, "heading", void 0), N([E({ attribute: !1 })], $.prototype, "forceMobile", void 0), N([E({ attribute: !1 })], $.prototype, "columns", void 0), N([D()], $.prototype, "_filterPanelOpen", void 0), N([D()], $.prototype, "_filterSheetOpen", void 0), N([D()], $.prototype, "_stagedCount", void 0), N([D()], $.prototype, "_stagedFilters", void 0), N([D()], $.prototype, "_confirm", void 0), N([D()], $.prototype, "_searchDraft", void 0), N([D()], $.prototype, "_editing", void 0), N([D()], $.prototype, "_editorBusy", void 0), N([D()], $.prototype, "_editorError", void 0), N([D()], $.prototype, "_detailItemId", void 0), N([D()], $.prototype, "_fullViewOpen", void 0), N([D()], $.prototype, "_startSelecting", void 0), N([D()], $.prototype, "_organizeOpen", void 0), N([D()], $.prototype, "_organizeTab", void 0), N([D()], $.prototype, "_diagnosticsOpen", void 0), N([D()], $.prototype, "_importOpen", void 0), N([D()], $.prototype, "_importPreview", void 0), N([D()], $.prototype, "_importSummary", void 0), N([D()], $.prototype, "_importBusy", void 0), N([D()], $.prototype, "_importError", void 0), N([D()], $.prototype, "_refreshBusy", void 0), N([D()], $.prototype, "_lastRefresh", void 0), N([D()], $.prototype, "_checkout", void 0), $ = N([T("hv-card-shell")], $);
function Wr() {
	try {
		return window.localStorage.getItem(Ur) === "1";
	} catch {
		return !1;
	}
}
function Gr(e) {
	try {
		window.localStorage.setItem(Ur, e ? "1" : "0");
	} catch {}
}
//#endregion
//#region src/index.ts
var Kr, qr = class extends b {
	constructor(...e) {
		super(...e), this._columns = kt(), this._columnPickerOpen = !1;
	}
	setConfig(e) {
		if (e !== null && typeof e != "object") throw Error("Invalid config");
		let t = e || {};
		this.config = { title: typeof t.title == "string" ? t.title : void 0 }, this.requestUpdate();
	}
	getCardSize() {
		return 6;
	}
	get hass() {
		return this._hass;
	}
	set hass(e) {
		this._hass = e, e && !this.store && (this.store = new _t(e), this._storeUnsub = this.store.state.onChange(() => {
			this.requestUpdate();
		}), this.store.init().catch(() => void 0)), this._syncColorScheme();
	}
	connectedCallback() {
		super.connectedCallback(), this.store && !this._storeUnsub && (this._storeUnsub = this.store.state.onChange(() => {
			this.requestUpdate();
		})), this._syncColorScheme();
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._storeUnsub && (this._storeUnsub(), this._storeUnsub = void 0);
	}
	firstUpdated() {
		this._syncColorScheme();
	}
	_syncColorScheme() {
		if (!this.isConnected || typeof getComputedStyle != "function") return;
		let e = zt(getComputedStyle(this));
		e && (this.style.colorScheme = e);
	}
	render() {
		return v`
      <hv-card-shell
        data-testid="card-shell"
        .store=${this.store}
        .heading=${this.config?.title ?? "Inventory"}
        .columns=${this._columns}
        @menu-action=${(e) => this._onShellAction(e.detail.id)}
      ></hv-card-shell>

      <hv-column-picker
        .open=${this._columnPickerOpen}
        .columns=${this._columns}
        heading="Full view columns"
        @change=${(e) => this._setColumns(e.detail.columns)}
        @cancel=${() => {
			this._columnPickerOpen = !1, this.requestUpdate();
		}}
      ></hv-column-picker>
    `;
	}
	_onShellAction(e) {
		switch (e) {
			case "columns":
				this._columnPickerOpen = !0, this.requestUpdate();
				break;
			case "export-all":
				this._exportDownload("all");
				break;
			case "export-view":
				this._exportDownload("view");
				break;
		}
	}
	async _exportDownload(e = "all") {
		try {
			let t = await this.store?.exportDocument(e);
			if (!t) return;
			let n = JSON.stringify(t, null, 2), r = (t.exported_at ?? "").replace(/[:]/g, "-") || "backup";
			this._triggerDownload(`haventory-export-${r}.json`, n);
		} catch (e) {
			console.error("HAventory export failed", e);
		}
	}
	_triggerDownload(e, t) {
		let n = new Blob([t], { type: "application/json" }), r = URL.createObjectURL(n), i = document.createElement("a");
		i.href = r, i.download = e, i.style.display = "none", document.body.appendChild(i), i.click(), i.remove(), URL.revokeObjectURL(r);
	}
	_setColumns(e) {
		this._columns = e, At(e), this.requestUpdate();
	}
};
Kr = qr, Kr.styles = o`
    :host {
      display: block;
      font-family: var(--paper-font-body1_-_font-family, var(--ha-card-font-family, Arial, sans-serif));
      font-size: var(--mdc-typography-body2-font-size, 14px);
      line-height: var(--mdc-typography-body2-line-height, 20px);
    }
  `, customElements.define("haventory-card", qr);
function Jr() {
	return {
		type: "custom:haventory-card",
		title: "HAventory"
	};
}
typeof window < "u" && (window.customCards = window.customCards || [], window.customCards.some((e) => e?.type === "haventory-card") || window.customCards.push({
	type: "haventory-card",
	name: "HAventory",
	description: "HAventory inventory card",
	preview: !0
}));
//#endregion
export { qr as HAventoryCard, Jr as getStubConfig };
