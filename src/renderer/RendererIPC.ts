import { ipcRenderer } from "electron";
import Renderer from "./render";
import { IFileWithContents, IPossiblyUntitledFile, IDirEntry } from "@common/fileio";
import { FileEvents, FsalEvents, UserEvents } from "@common/events";

export default class RendererIPC {
	_app:Renderer;

	constructor(appRenderer:Renderer){
		this._app = appRenderer;
	}

	init(){
		console.log("RendererIPC :: init()");

		ipcRenderer.on(FileEvents.FILE_DID_OPEN, (event:Event, file:IFileWithContents)=> {
			console.log("RendererIPC :: FILE_OPENED");
			this._app.setCurrentFile(file);
		});

		ipcRenderer.on(FileEvents.FILE_DID_SAVE, (event: Event, arg: Object) => {
			console.log("RendererIPC :: FILE_SAVED", event, arg);
		});

		ipcRenderer.on(FileEvents.FILE_DID_SAVEAS, (event: Event, filePath: string) => {
			console.log("RendererIPC :: FILE_SAVED_AS", event, filePath);
			this._app.setCurrentFilePath(filePath);
		});

		ipcRenderer.on(FsalEvents.FILETREE_CHANGED, (event: Event, fileTree: IDirEntry[]) => {
			console.log("RendererIPC :: filetree-changed", event, fileTree);
			if(!this._app._explorer){ return; }
			this._app._explorer.setFileTree(fileTree);
		});
	}

	////////////////////////////////////////////////////////

	openFileDialog(){
		console.log("RendererIPC :: openFileDialog()");
		ipcRenderer.send(UserEvents.DIALOG_FILE_OPEN);
	}

	openSaveAsDialog(fileInfo:IPossiblyUntitledFile) {
		console.log("RendererIPC :: openSaveAsDialog()");
		ipcRenderer.send(UserEvents.DIALOG_FILE_SAVEAS, fileInfo);
	}

	requestFileSave(fileInfo:IFileWithContents){
		console.log("RendererIPC :: requestFileSave()");
		ipcRenderer.send(UserEvents.REQUEST_FILE_SAVE, fileInfo);
	}

	////////////////////////////////////////////////////////

	/* DISPATCH
	 * Dispatch a command to the parent.
	 * @param (arg) message body
	 */
	dispatch(arg:{command:string, content?:Object }){
		this.handleEvent(arg.command, arg.content);
	}

	send(command:string, arg:{}={}){

	}

	/* HANDLEEVENT
	 * Act on messages received from the main process.
	 * @param (cmd) message sent from main
	 * @param (content) message body
	 */
	handleEvent(cmd:string, content:any) {
		switch (cmd) {
			// FILE_OPEN
			case FileEvents.FILE_DID_OPEN:
				break;
			// FILE_SAVE
			case FileEvents.FILE_DID_SAVE:
				break;
			// UNKNOWN
			default:
				console.log("RendererIPC :: unknown command");
				break;
		}
	}
}