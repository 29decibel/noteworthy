import { dialog, shell } from "electron";
import { readFile, saveFile, IFileWithContents, IPossiblyUntitledFile, IDirEntryMeta, IFileMeta } from "@common/fileio";
import NoteworthyApp from "./app"
import { DialogSaveDiscardOptions } from "@common/dialog";
import { to } from "@common/util/to";
import { filterNonVoid } from "@common/helpers";

////////////////////////////////////////////////////////////

/** @todo (7/12/20) move to separate file (duplicated in ipc.ts right now) */
type FunctionPropertyNames<T> = { [K in keyof T]: T[K] extends Function ? K : never }[keyof T];
type FunctionProperties<T> = Pick<T, FunctionPropertyNames<T>>;

////////////////////////////////////////////////////////////

export class MainIpcHandlers {
	private _app: NoteworthyApp;

	constructor(app: NoteworthyApp) {
		this._app = app;
	}

	//// DIALOGS ///////////////////////////////////////////

	// -- Show Notification ----------------------------- //

	showNotification(msg: string) {
		/** @todo (6/26/20) implement notifications */
	}

	showError(msg: string) {
		/** @todo (6/26/20) implement error notifications */
	}

	// -- Request Folder Open --------------------------- //

	dialogFolderOpen() {
		if (!this._app.window) { return; }

		// open file dialog
		const dirPaths: string[] | undefined = dialog.showOpenDialogSync(
			this._app.window.window,
			{
				properties: ['openDirectory', 'createDirectory'],
				//filters: FILE_FILTERS
			}
		);
		if (!dirPaths || !dirPaths.length) return;

		this._app.setWorkspaceDir(dirPaths[0]);
	}

	// -- Request File Open ----------------------------- //

	dialogFileOpen() {
		if (!this._app.window) { return; }

		// open file dialog
		const filePaths: string[] | undefined = dialog.showOpenDialogSync(
			this._app.window.window,
			{
				properties: ['openFile'],
				//filters: FILE_FILTERS
			}
		);
		// if no path selected, do nothing
		if (!filePaths || !filePaths.length) return;

		// load file from path
		this.requestFileOpen({ path: filePaths[0] })
	}

	// -- Dialog File Save As --------------------------- //

	async dialogFileSaveAs(file: IPossiblyUntitledFile): Promise<string | null> {
		if (!this._app.window) { return null; }

		const newFilePath: string | undefined = dialog.showSaveDialogSync(
			//TODO: better default "save as" path?
			this._app.window.window,
			{
				defaultPath: file.path || "",
				//filters: FILE_FILTERS
			}
		);
		if (!newFilePath) return null;
		saveFile(newFilePath, file.contents);

		// send new file path to renderer
		this._app._renderProxy?.fileDidSave({ saveas: true, path: newFilePath});
		return newFilePath;
	}

	// -- Ask Save/Discard Changes ---------------------- //

	/** @todo (7/12/20) better return type? extract array type? **/
	async askSaveDiscardChanges(filePath: string): Promise<typeof DialogSaveDiscardOptions[number]> {
		if (!this._app.window) { throw new Error("no window open! cannot open dialog!"); }
		let response = await dialog.showMessageBox(this._app.window.window, {
			type: "warning",
			title: "Warning: Unsaved Changes",
			message: `File (${filePath}) contains unsaved changes.`,
			buttons: Array.from(DialogSaveDiscardOptions),
			defaultId: DialogSaveDiscardOptions.indexOf("Save"),
			cancelId: DialogSaveDiscardOptions.indexOf("Cancel"),
		})
		return DialogSaveDiscardOptions[response.response];
	}

	//// APPLICATION ///////////////////////////////////////

	async requestAppQuit():Promise<void>{
		/** @todo (7/12/20) handle multiple windows? multiple files open? */
		if(this._app._renderProxy){
			// attempt to close active editors/windows
			let [err, result] = await to<string>(this._app._renderProxy.requestClose());
			// ok if promise rejects because user cancelled shutdown
			if(err == "Cancel"){ return; }
			// anything else is an error
			else if(err){ return Promise.reject(err); }
		}
		// close app
		this._app.quit();
	}

	//// FILES /////////////////////////////////////////////

	// -- Request File Create --------------------------- //

	async requestFileCreate(path:string, contents:string=""):Promise<IFileMeta|null> {
		/** @todo (6/26/20) check if path in workspace? */
		return this._app._fsal.createFile(path, contents)
			.then(
				() => { return this._app.workspace?.updatePath(path)||null; },
				(reason) => { console.error("error creating file", reason); return null; }
			)
	}

	// -- Request File Save ----------------------------- //

	async requestFileSave(file: IFileWithContents): Promise<boolean> {
		if (!this._app.window) { return false; }

		saveFile(file.path, file.contents);
		/** @todo (7/12/20) check for file save errors? */
		this._app._renderProxy?.fileDidSave({saveas: false, path: file.path });
		return true;
	}

	// -- Request File Open ----------------------------- //

	async requestFileContents(fileInfo: { hash?: string, path?: string }):Promise<IFileWithContents|null> {
		let { hash, path } = fileInfo;
		// validate input
		if (hash === undefined && path === undefined) {
			throw new Error("MainIPC :: requestFileContents() :: no file path or hash provided");
		}

		// load from hash
		let fileMeta: IFileMeta | null;
		if (hash === undefined || !(fileMeta = this._app.getFileByHash(hash))) {
			/** @todo (6/20/20) load from arbitrary path */
			throw new Error("file loading from arbitrary path not implemented");
		}

		// read file contents
		const fileContents: string | null = readFile(fileMeta.path);
		if (fileContents === null) { throw new Error("MainIPC :: failed to read file"); }

		let file: IFileWithContents = {
			parent: null,
			contents: fileContents,
			...fileMeta
		}

		return file;
	}

	async requestFileOpen(fileInfo: { hash?: string, path?: string }):Promise<void> {
		if (!this._app.window) { return; }
		let file = await this.requestFileContents(fileInfo);
		if(file) { this._app._renderProxy?.fileDidOpen(file); }
	}

	//// TAGS //////////////////////////////////////////////

	// -- Request External Link Open -------------------- //

	async requestExternalLinkOpen(url: string) {
		shell.openExternal(url, { activate: true });
	}

	// -- Request Tag Open ------------------------------ //

	async tagSearch(query:string):Promise<IFileMeta[]> {
		const hashes:string[]|null = this._app.getTagMentions(query);
		if(hashes === null){ return []; }
		return filterNonVoid( hashes.map(hash => (this._app.getFileByHash(hash))) );
	}

	async getHashForTag(data: { tag: string, create: boolean }):Promise<string|null> {
		// get files which define this tag
		let defs: string[] | null = this._app.getDefsForTag(data.tag);
		let fileHash: string;

		if (defs == null) {
			// expect NULL when no crossref plugin active
			console.error("crossref plugin not active")
			return null;
		} else if (defs.length == 0) {
			// create a file for this tag when none exists?
			if (!data.create) { return null; }
			console.log(`MainIPC :: creating file for tag '${data.tag}'`);

			/** @todo (6/27/20)
			 * what if data.tag is not a valid file name?
			 * what if it contains slashes?  what if it uses \ instead of /?
			 */

			// create file for this tag when none exists
			let fileName: string = data.tag + ".md";
			let filePath: string | null = this._app.resolveWorkspaceRelativePath(fileName);
			if (!filePath) {
				console.error("MainIPC :: could not create file for tag, no active workspace");
				return null;
			}

			// create file
			let fileContents: string = this._app.getDefaultFileContents(".md", fileName)
			let file: IFileMeta | null = await this.requestFileCreate(filePath, fileContents);
			if (!file) {
				console.error("MainIPC :: unknown error creating file for tag");
				return null;
			}

			// set hah
			fileHash = file.hash;
		} else if (defs.length == 1) {
			fileHash = defs[0];
		} else {
			/** @todo (6/20/20) handle more than one defining file for tag */
			return null;
		}

		return fileHash;
	}

	async getFileForTag(data: { tag: string, create: boolean }):Promise<IFileMeta|null> {
		let fileHash = await this.getHashForTag(data);
		if (!fileHash) return null;
		return this._app.getFileByHash(fileHash);
	}

	async requestTagOpen(data:{tag: string, create:boolean}):Promise<void> {
		if (!this._app.window) { return; }

		// get files which define this tag
		let fileHash = await this.getHashForTag(data);
		if(!fileHash) return;
		// load file from hash
		this.requestFileOpen({ hash: fileHash });
	}
}

export type MainIpcEvents = keyof MainIpcHandlers;