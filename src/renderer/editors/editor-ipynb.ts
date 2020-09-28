// project imports
import { IPossiblyUntitledFile, IUntitledFile } from "@common/fileio";
import { Editor } from "./editor";
import { ipynbSchema, ipynbParser, ipynbSerializer } from "@common/ipynb";
import { buildInputRules_markdown, buildKeymap_markdown } from "@common/pm-schema";

// prosemirror
import { EditorView as ProseEditorView, EditorView } from "prosemirror-view";
import { Schema as ProseSchema, DOMParser as ProseDOMParser } from "prosemirror-model";
import { EditorState as ProseEditorState, Transaction, Plugin as ProsePlugin } from "prosemirror-state";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";

// views
import { ICursorPosObserver, MathView } from "@lib/prosemirror-math/src/math-nodeview";
import { mathInputRules } from "@lib/prosemirror-math/src/plugins/math-inputrules";
import { MainIpcHandlers } from "@main/MainIPC";
import { ProseCommand } from "@common/types";
import { mathPlugin } from "@root/lib/prosemirror-math/src/math-plugin";

////////////////////////////////////////////////////////////

// editor class
export class IpynbEditor extends Editor<ProseEditorState> {

	_proseEditorView: ProseEditorView | null;
	_proseSchema: ProseSchema;
	_keymap: ProsePlugin;
	_initialized: boolean;

	// == Constructor =================================== //

	constructor(file: IPossiblyUntitledFile | null, editorElt: HTMLElement, mainProxy: MainIpcHandlers) {
		super(file, editorElt, mainProxy);

		// no editor until initialized
		this._initialized = false;
		this._proseEditorView = null;
		this._proseSchema = ipynbSchema;

		const insertStar:ProseCommand = (state, dispatch) => {
			var type = this._proseSchema.nodes.star;
			var ref = state.selection;
			var $from = ref.$from;
			if (!$from.parent.canReplaceWith($from.index(), $from.index(), type)) { return false }
			if(dispatch){
				dispatch(state.tr.replaceSelectionWith(type.create()));
			}
			return true
		}

		this._keymap = this._keymap = keymap({
			"Ctrl-b": toggleMark(this._proseSchema.marks.shouting),
			"Ctrl-Space": insertStar,
		})
	}

	// == Lifecycle ===================================== //

	init() {
		// initialize only once
		if(this._initialized){ return; }
		// create prosemirror config
		let config = {
			schema: this._proseSchema,
			plugins: [
				keymap(baseKeymap),
				keymap(buildKeymap_markdown(this._proseSchema)),
				buildInputRules_markdown(this._proseSchema),
				mathPlugin,
			]
		};
		// create prosemirror state (from file)
		let state:ProseEditorState;
		if (this._currentFile && this._currentFile.contents) {
			state = this.parseContents(this._currentFile.contents);
		} else {
			state = ProseEditorState.create(config);
		}
		// create prosemirror instance
		let nodeViews: ICursorPosObserver[] = [];
		this._proseEditorView = new ProseEditorView(this._editorElt, {
			state: state,
			dispatchTransaction: (tr: Transaction): void => {
				let proseView: EditorView = (this._proseEditorView as EditorView);

				// update 
				for (let mathView of nodeViews) {
					mathView.updateCursorPos(proseView.state);
				}

				// apply transaction
				proseView.updateState(proseView.state.apply(tr));
			}
		});
		// initialized
		this._initialized = true;
	}

	destroy(): void {
		// destroy prosemirror instance
		this._proseEditorView?.destroy();
		this._proseEditorView = null;
		// de-initialize
		this._initialized = false;
	}

	// == Document Model ================================ //

	serializeContents(): string {
		throw new Error("Method not implemented.");
	}

	parseContents(contents: string): ProseEditorState {
		let config = {
			schema: this._proseSchema,
			plugins: [
				keymap(baseKeymap),
				keymap(buildKeymap_markdown(this._proseSchema)),
				buildInputRules_markdown(this._proseSchema)
			]
		}

		// parse
		let parsed = ipynbParser.parse(contents);
		return ProseEditorState.fromJSON(config, parsed);
	}

	setContents(contents: ProseEditorState): void {
		this._proseEditorView?.updateState(contents);
	}

	// == File Management =============================== //

	async saveCurrentFile(saveas: boolean = true) {
		console.warn("editor-ipynb :: saving not implemented");
	}
}