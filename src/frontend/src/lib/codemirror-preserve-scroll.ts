import { Transaction } from '@codemirror/state'
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'

/**
 * CodeMirror extension that preserves the scroll position when the document
 * is updated externally (e.g. during AI streaming).
 *
 * @uiw/react-codemirror annotates prop-driven updates with Transaction.remote.
 * Without this extension, each streamed chunk resets the viewport to the top
 * because the document replacement moves the cursor to position 0.
 */
export const preserveScrollOnExternalUpdate = ViewPlugin.fromClass(
  class {
    private scrollTop = 0
    declare view: EditorView

    update(update: ViewUpdate) {
      if (
        update.docChanged &&
        update.transactions.some(tr => tr.annotation(Transaction.remote))
      ) {
        const dom = update.view.scrollDOM
        const saved = this.scrollTop
        requestAnimationFrame(() => { dom.scrollTop = saved })
      }
    }
  },
  {
    eventHandlers: {
      scroll(_e: Event, self) {
        (self as any).scrollTop = (self as any).view.scrollDOM.scrollTop
      },
    },
  }
)
