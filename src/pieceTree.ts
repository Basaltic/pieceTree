import NodePiece, { Piece, Line, PieceType, determinePieceType } from './piece'
import PieceTreeBase from './pieceTreebase'
import PieceTreeNode, { SENTINEL } from './pieceTreeNode'
import Change, {
  InsertChange,
  createInsertChange,
  DeleteChange,
  createDeleteChange,
  FormatChange,
  createFormatChange,
  PiecePatch,
  ChangeStack,
} from './change'
import { IPieceMeta, mergeMeta } from './meta'
import { Diff } from './diff'
import StringBuffer from './stringBuffer'
import { CharCode } from 'charCode'
import { applyPatches } from 'immer'
import cloneDeep from 'lodash.clonedeep'

const EOL = '\n'
const FIRST_LINE_SPECIAL_SYMBOL = -10000

export interface PieceTreeConfig {
  initialLines?: Line[]
}

/**
 * Piece Tree Implementation
 *
 *
 * view ---> operation ---> diff
 *   |<-----------------------|
 *
 * /n - piece1 - piece2 - /n - piece3 - piece4 - /n
 *  |
 * start
 *
 * Every Line Start with a line feed symbol.
 *
 */
export class PieceTree extends PieceTreeBase {
  // A Stack to manage the changes
  private changeHistory: ChangeStack = new ChangeStack()

  constructor(config: PieceTreeConfig = {}) {
    super()

    const { initialLines } = config

    // Defaultly add a eol
    if (initialLines) {
      const lineBreakStringBuffer = new StringBuffer(EOL)
      this.buffers.push(lineBreakStringBuffer)
      const linBreakBufferindex = this.buffers.length - 1
      let node = this.root
      for (const line of initialLines) {
        const lbPiece = new NodePiece(linBreakBufferindex, 0, 1, 1, line.meta)
        node = this.insertFixedRight(node, lbPiece)

        for (const ipiece of line.pieces) {
          const { text, length, meta } = ipiece

          let bufferIndex = -1
          if (text) {
            const buffer = new StringBuffer(text)
            this.buffers.push(buffer)
            bufferIndex = this.buffers.length - 1
          }

          const nodePiece = new NodePiece(bufferIndex, 0, length, 0, meta)
          node = this.insertFixedRight(node, nodePiece)
        }
      }
    } else {
      this.insert(0, EOL, null)
    }
  }

  // ------------- Change -------------- //

  /**
   * Change.
   * @param callback
   */
  change(callback: (...args: any) => void) {
    this.startChange()

    try {
      callback()
    } catch (e) {}

    this.endChange()
  }

  /**
   * Mark as operation started
   * operations between start and end will redo\undo in same operation
   */
  startChange() {
    this.changeHistory.startChange()
  }

  /**
   * Mark as operation end
   */
  endChange() {
    this.changeHistory.endChange()
  }

  /**
   * Redo the operation
   */
  redo(): Diff[] {
    return this.changeHistory.applayRedo(change => this.doRedo(change))
  }

  /**
   * Undo the operation
   */
  undo(): Diff[] {
    return this.changeHistory.applayUndo(change => this.doUndo(change))
  }

  /**
   * Actual Operation to undo the change
   * @param change
   */
  private doUndo(change: Change): Diff[] {
    switch (change.type) {
      case 'insert':
        const insertChange = change as InsertChange
        this.deleteInner(insertChange.startOffset, insertChange.length)
        return change.diffs.map(diff => {
          if (diff.type === 'insert') {
            diff.type = 'remove'
          }
          return diff
        })
      case 'delete':
        {
          const deleteChange = change as DeleteChange

          let offset = deleteChange.startOffset

          const nodePosition = this.findByOffset(offset)
          // Start of node
          if (nodePosition.startOffset === offset) {
            let node = nodePosition.node.predecessor()

            if (node === SENTINEL) {
              for (const piece of deleteChange.pieces) {
                this.insertFixedLeft(nodePosition.node, piece)
              }
            } else {
              for (const piece of deleteChange.pieces) {
                this.insertFixedRight(node, piece)
                node = node.successor()
              }
            }
          }
          // End of node
          else if (nodePosition.reminder === nodePosition.node.piece.length) {
            let node = nodePosition.node
            for (const piece of deleteChange.pieces) {
              this.insertFixedRight(node, piece)
              node = node.successor()
            }
          }
        }

        // Change 'remove' to 'insert'
        return change.diffs.map(diff => {
          if (diff.type === 'remove') {
            diff.type = 'insert'
          }
          return diff
        })
      case 'format':
        const formatChange = change as FormatChange
        if (formatChange.piecePatches.length > 0) {
          for (const patch of formatChange.piecePatches) {
            const { startOffset, inversePatches } = patch
            let offset = startOffset

            let { node, reminder } = this.findByOffset(offset)

            if (reminder === node.piece.length) node = node.successor()
            node.piece.meta = applyPatches(node.piece.meta || {}, inversePatches)
          }
        }
        return change.diffs
    }
  }

  /**
   * Actual Operation to redo the change
   * @param change
   */
  private doRedo(change: Change): Diff[] {
    switch (change.type) {
      case 'insert':
        const { startOffset, text, meta } = change as InsertChange
        const txt = this.getTextInBuffer(text[0], text[1], text[2])
        return this.insertInner(startOffset, txt, meta)
      case 'delete':
        const deleteChange = change as DeleteChange
        return this.deleteInner(deleteChange.startOffset, deleteChange.length)
      case 'format':
        const formatChange = change as FormatChange
        return this.formatInner(formatChange.startOffset, formatChange.length, formatChange.meta)
    }
  }

  // ---------------- Extra Operations To Make Life Easier --------------- //

  /**
   * Break The Content into two lines
   * @param offset
   * @param meta
   */
  insertLineBreak(offset: number, meta: IPieceMeta | null = null): Diff[] {
    return this.insert(offset, EOL, meta)
  }

  /**
   * Insert A Complete new Line in Offset
   * @param offset
   * @param meta
   */
  insertLine(offset: number, meta: IPieceMeta | null = null): Diff[] {
    const diff1 = this.insertLineBreak(offset, null)
    const diff2 = this.insert(offset, '', meta)
    const diff3 = this.insertLineBreak(offset + 2, null)
    return [...diff1, ...diff2, ...diff3]
  }

  /**
   * Insert Plain Text
   * @param offset
   * @param text
   * @param meta
   */
  insertText(offset: number, text: string, meta: IPieceMeta | null = null): Diff[] {
    if (text === '') {
      throw new Error('cannot pass empty text')
    }

    return this.insert(offset, text, meta)
  }

  /**
   * Insert Non Text
   * @param offset
   * @param meta
   */
  insertNonText(offset: number, meta: IPieceMeta): Diff[] {
    return this.insert(offset, '', meta)
  }

  /**
   * Delete The Entire Line Contents
   * @param lineNumber
   */
  deleteLine(lineNumber: number): Diff[] {
    const cnt = this.getLength()
    const lineCnt = this.getLineCount()

    if (lineCnt === 1) {
      if (lineNumber === 1) {
        return this.deleteInner(1, cnt)
      }
      return []
    } else {
      if (lineNumber === lineCnt) {
        const { startOffset } = this.findByLineNumber(lineNumber)
        return this.deleteInner(startOffset, cnt)
      } else if (lineNumber > lineCnt || lineNumber <= 0) {
        return []
      } else {
        const posStart = this.findByLineNumber(lineNumber)
        const posEnd = this.findByLineNumber(lineNumber + 1)

        const len = posEnd.startOffset - posStart.startOffset
        return this.deleteInner(posStart.startOffset, len)
      }
    }
  }

  /**
   * Format the Specific Line
   * @param lineNumber
   * @param meta
   */
  formatLine(lineNumber: number, meta: IPieceMeta): Diff[] {
    const { startOffset } = this.findByLineNumber(lineNumber)
    return this.formatInner(startOffset, 1, meta, PieceType.LINE_FEED)
  }

  /**
   * Change All Piece Meta In The Line
   */
  formatInLine(lineNumber: number, meta: IPieceMeta): Diff[] {
    const cnt = this.getLength()
    const lineCnt = this.getLineCount()

    if (lineCnt === 1) {
      if (lineNumber === 1) {
        return this.formatInner(1, cnt, meta)
      }
      return []
    } else {
      if (lineNumber === lineCnt) {
        const { startOffset } = this.findByLineNumber(lineNumber)
        return this.formatInner(startOffset + 1, cnt, meta)
      } else if (lineNumber > 0 && lineNumber <= lineCnt) {
        const posStart = this.findByLineNumber(lineNumber)
        const posEnd = this.findByLineNumber(lineNumber + 1)

        const len = posEnd.startOffset - posStart.startOffset
        return this.formatInner(posStart.startOffset + 1, len, meta)
      } else {
        return []
      }
    }
  }

  /**
   * Change All Text Piece Meta In The Line
   */
  formatTextInLine(lineNumber: number, meta: IPieceMeta): Diff[] {
    const cnt = this.getLength()
    const lineCnt = this.getLineCount()

    if (lineCnt === 1) {
      if (lineNumber === 1) {
        return this.formatText(1, cnt, meta)
      }
      return []
    } else {
      if (lineNumber === lineCnt) {
        const { startOffset } = this.findByLineNumber(lineNumber)
        return this.formatText(startOffset, cnt, meta)
      } else if (lineNumber > 0 && lineNumber <= lineCnt) {
        const posStart = this.findByLineNumber(lineNumber)
        const posEnd = this.findByLineNumber(lineNumber + 1)

        const len = posEnd.startOffset - posStart.startOffset
        return this.formatText(posStart.startOffset, len, meta)
      } else {
        return []
      }
    }
  }

  /**
   * Change All Non-Text Piece Meta In The Line
   */
  formatNonTextInLine(lineNumber: number, meta: IPieceMeta): Diff[] {
    const cnt = this.getLength()
    const lineCnt = this.getLineCount()

    if (lineCnt === 1) {
      if (lineNumber === 1) {
        return this.formatNonText(1, cnt, meta)
      }
      return []
    } else {
      if (lineNumber === lineCnt) {
        const { startOffset } = this.findByLineNumber(lineNumber)
        return this.formatNonText(startOffset, cnt, meta)
      } else if (lineNumber > 0 && lineNumber <= lineCnt) {
        const posStart = this.findByLineNumber(lineNumber)
        const posEnd = this.findByLineNumber(lineNumber + 1)

        const len = posEnd.startOffset - posStart.startOffset
        return this.formatNonText(posStart.startOffset, len, meta)
      } else {
        return []
      }
    }
  }

  /**
   * Format Text Piece
   * @param offset
   */
  formatText(offset: number, length: number, meta: IPieceMeta): Diff[] {
    return this.formatInner(offset, length, meta, PieceType.TEXT)
  }

  /**
   * Format Non-Text Pieces
   * @param offset
   * @param length
   * @param meta
   */
  formatNonText(offset: number, length: number, meta: IPieceMeta): Diff[] {
    return this.formatInner(offset, length, meta, PieceType.NON_TEXT)
  }

  // ------------------- Atomic Operation ---------------------- //

  /**
   * Insert Content Which will cause offset change, piece increment, piece split
   * 1. Always create a new piece while having meta
   * 2. Coninuesly input only text, append to same node
   * 3. LineBreak(\n) will in a new piece which used to store line data
   */
  insert(offset: number, text: string = '', meta?: any): Diff[] {
    if (offset <= 0) {
      offset = 1
    } else {
      offset += 1
    }

    return this.insertInner(offset, text, meta)
  }

  /**
   * Delete Content
   */
  delete(offset: number, length: number): Diff[] {
    if (offset <= 0) {
      offset = 1
    } else {
      offset += 1
    }

    return this.deleteInner(offset, length)
  }

  /**
   * Format The Content. Only change the meta
   */
  format(offset: number, length: number, meta: IPieceMeta): Diff[] {
    // Notice: The Piece Tree will have a default line break piece. Adjust the offset
    if (offset === FIRST_LINE_SPECIAL_SYMBOL) {
      offset = 0
    } else if (offset <= 0) {
      offset = 1
    } else {
      offset += 1
    }

    return this.formatInner(offset, length, meta)
  }

  protected insertInner(offset: number, text: string = '', meta?: any) {
    const diffs: Diff[] = []

    const addBuffer = this.buffers[0]

    const isEmptyMeta = meta === undefined || meta === null

    const nodePosition = this.findByOffset(offset)
    let { node, reminder, startOffset, startLineFeedCnt } = nodePosition

    if (startOffset === offset) {
      node = node.predecessor()
    } else if (offset > startOffset && offset < startOffset + node.piece.length) {
      const [leftNode] = this.splitNode(node, reminder)
      node = leftNode
    } else {
      startLineFeedCnt += node.piece.lineFeedCnt
    }

    const isNotLinkBreak = node.piece.lineFeedCnt <= 0
    const isContinousInput = node.isNotNil && node.piece.bufferIndex === 0 && addBuffer.length === node.piece.start + node.piece.length

    let txt = ''
    let lineFeedCnt = 0

    for (let i = 0, length = text.length; i < length; i++) {
      let charCode = text.charCodeAt(i)
      if (charCode === CharCode.LineFeed) {
        if (lineFeedCnt === 0) {
          if (isContinousInput && isEmptyMeta && isNotLinkBreak && txt) {
            addBuffer.buffer += txt
            node.piece.length += txt.length
            node.updateMetaUpward()
          } else if (txt || !isEmptyMeta) {
            node = this.insertFixedRight(node, this.createPiece(txt, meta, 0))
          }
        } else if (txt) {
          node = this.insertFixedRight(node, this.createPiece(txt, meta, 0))
        }

        node = this.insertFixedRight(node, this.createPiece(EOL, meta, 1))

        txt = ''
        lineFeedCnt++
      } else {
        txt += text[i]
      }
    }

    if (lineFeedCnt === 0) {
      if (isContinousInput && isEmptyMeta && isNotLinkBreak && txt) {
        addBuffer.buffer += txt
        node.piece.length += txt.length
        node.updateMetaUpward()
      } else if (txt || !isEmptyMeta) {
        this.insertFixedRight(node, this.createPiece(txt, meta, 0))
      }
    } else if (txt) {
      this.insertFixedRight(node, this.createPiece(txt, meta, 0))
    }

    // Create Diffs
    for (let i = 0; i <= lineFeedCnt; i++) {
      if (i === 0) {
        diffs.push({ type: 'replace', lineNumber: startLineFeedCnt })
      } else {
        diffs.push({ type: 'insert', lineNumber: startLineFeedCnt + i })
      }
    }

    const change: InsertChange = createInsertChange(offset, [0, addBuffer.length - text.length, text.length], meta, diffs)
    this.changeHistory.push(change)

    return diffs
  }

  protected deleteInner(offset: number, length: number) {
    const pieceChange: NodePiece[] = []
    const originalLength = length

    // delete
    const startNodePosition = this.findByOffset(offset)
    let { node, startOffset, startLineFeedCnt } = startNodePosition
    if (offset !== startOffset) {
      const reminder = offset - startOffset
      if (reminder === node.piece.length) {
        node = node.successor()
      } else {
        const [, rightNode] = this.splitNode(node, reminder)
        node = rightNode
      }
    }

    let lineFeedCnt = 0

    while (length > 0) {
      // 1. The length is actually same as the node length. just delete this node
      if (length === node.piece.length) {
        this.deleteNode(node)
        length -= node.piece.length
        lineFeedCnt += node.piece.lineFeedCnt

        // record the delete change
        pieceChange.push(node.piece)
      }
      // 2. The length is larger than node length. just delete this ndoe and go deeper
      else if (length >= node.piece.length) {
        const currentNode = node
        node = node.successor()

        this.deleteNode(currentNode)
        length -= currentNode.piece.length
        lineFeedCnt += currentNode.piece.lineFeedCnt

        // record the delete change
        pieceChange.push(currentNode.piece)
      }
      // 3. The length is smaller than node length. delete part of node
      else {
        const originalStart = node.piece.start
        const originalLineFeedCnt = node.piece.lineFeedCnt

        node.piece.start += length
        node.piece.length -= length
        node.piece.lineFeedCnt = this.recomputeLineFeedsCntInPiece(node.piece)

        lineFeedCnt += originalLineFeedCnt - node.piece.lineFeedCnt

        // record the delete change
        pieceChange.push(new NodePiece(node.piece.bufferIndex, originalStart, length, originalLineFeedCnt - node.piece.lineFeedCnt))

        // set to 0 to force the recursive end
        length = 0
      }
    }

    // diffs
    const diffs: Diff[] = []
    for (let i = 0; i <= lineFeedCnt; i++) {
      if (i === 0) diffs.push({ type: 'replace', lineNumber: startLineFeedCnt + i })
      else diffs.push({ type: 'remove', lineNumber: startLineFeedCnt + i })
    }

    // changes
    const change: DeleteChange = createDeleteChange(offset, originalLength, pieceChange, diffs)
    this.changeHistory.push(change)

    return diffs
  }

  protected formatInner(offset: number, length: number, meta: IPieceMeta, type: PieceType = PieceType.ALL): Diff[] {
    const piecePatches: PiecePatch[] = []
    const originalOffset = offset
    const originalLength = length

    // format
    let { node, startOffset, startLineFeedCnt, reminder } = this.findByOffset(offset)

    if (reminder === node.piece.length) {
      node = node.successor()
      startLineFeedCnt += node.piece.lineFeedCnt
    } else if (reminder > 0 && reminder < node.piece.length) {
      const reminder = offset - startOffset
      const [leftNode, rightNode] = this.splitNode(node, reminder)
      node = rightNode
      startLineFeedCnt += leftNode.piece.lineFeedCnt
    }

    let lineFeedCnt: number = 0
    while (length > 0) {
      // skip according to piece type
      if (type !== PieceType.ALL) {
        const determinedType = determinePieceType(node.piece)
        if (determinedType !== type) {
          length -= node.piece.length
          offset += node.piece.length

          node = node.successor()

          continue
        }
      }

      if (length >= node.piece.length) {
        lineFeedCnt += node.piece.lineFeedCnt
        const mergeResult = mergeMeta(node.piece.meta, meta)
        if (mergeResult !== null) {
          const [target, inversePatches] = mergeResult
          node.piece.meta = target
          piecePatches.push({ startOffset: offset, length: node.piece.length, inversePatches })
        }

        length -= node.piece.length
        offset += node.piece.length

        node = node.successor()
      } else {
        const [leftNode] = this.splitNode(node, length)
        node = leftNode

        // Line feeds counting. Meta Merge
        lineFeedCnt += node.piece.lineFeedCnt
        const mergeResult = mergeMeta(node.piece.meta, meta)
        if (mergeResult !== null) {
          const [target, inversePatches] = mergeResult
          node.piece.meta = target
          piecePatches.push({ startOffset: offset, length: node.piece.length, inversePatches })
        }

        length -= node.piece.length
        offset += node.piece.length
      }
    }

    // diffs
    const diffs: Diff[] = []
    for (let i = 0; i <= lineFeedCnt; i++) {
      diffs.push({ type: 'replace', lineNumber: startLineFeedCnt + i })
    }

    // changes
    const change: FormatChange = createFormatChange(originalOffset, originalLength, meta, piecePatches, diffs)
    this.changeHistory.push(change)

    return diffs
  }

  // ----------------------- Iterate ------------------------------- //

  /**
   * Iterate the line in this piece tree
   * @param callback
   */
  forEachLine(callback: (line: Line, lineNumber: number) => void) {
    let node = this.root.findMin()
    let line: Line = { meta: {}, pieces: [] }
    let lineNumber: number = 1

    line.meta = node.piece.meta

    node = node.successor()
    while (node.isNotNil) {
      const { piece } = node
      const { meta, length } = piece

      if (piece.lineFeedCnt === 0) {
        const text = this.getTextInPiece(piece)
        line.pieces.push({ text, length, meta })
      } else {
        callback(line, lineNumber)

        line = { meta: node.piece.meta, pieces: [] }
        lineNumber++
      }

      node = node.successor()
    }

    // Empty Line
    if (line.pieces.length === 0) {
      line = { meta: null, pieces: [{ text: '', length: 0, meta: null }] }
    }

    callback(line, lineNumber)
  }

  /**
   * Interate all the pieces
   * @param callback
   */
  protected forEachPiece(callback: (piece: Piece, index: number) => void) {
    let node = this.root.findMin()
    node = node.successor()
    if (node === SENTINEL) return

    let index = 0
    while (node.isNotNil) {
      const { length, meta } = node.piece
      const text = this.getTextInPiece(node.piece)
      callback({ text, length, meta }, index)
      node = node.successor()
      index++
    }
  }

  // ----------------------- Iterate End ------------------------ //

  // ---- Fetch Operation ---- //

  /**
   * Get the Whole Text
   */
  getText(): string {
    let txt = ''
    this.forEachPiece(piece => {
      txt += piece.text
    })
    return txt
  }

  /**
   * Get Text String in Range
   * @param from
   * @param to
   */
  getTextInRange(from: number, to: number): string {
    from++
    to++
    if (to > from && from >= 0) {
      to = to - from
      let text = ''
      let { node, reminder } = this.findByOffset(from)

      if (reminder === node.piece.length) {
        node = node.successor()
      } else if (reminder > 0 && reminder < node.piece.length) {
        const { bufferIndex, start, length } = node.piece
        const s = start + reminder
        const len = length - reminder
        text += this.getTextInBuffer(bufferIndex, s, len)
        node = node.successor()
        to -= len
      }

      while (node !== SENTINEL && to > 0) {
        const { start, bufferIndex, length } = node.piece
        if (to < node.piece.length) {
          text += this.getTextInBuffer(bufferIndex, start, to)
        } else {
          text += this.getTextInPiece(node.piece)
        }

        to -= length
        node = node.successor()
      }

      return text
    } else {
      return ''
    }
  }

  /**
   * get piece list of some line
   * @param lineNumber
   */
  getLine(lineNumber: number): Line {
    const line: Line = { meta: null, pieces: [] }

    let { node } = this.findByLineNumber(lineNumber)
    line.meta = node.piece.meta

    node = node.successor()

    while (node !== SENTINEL && node.piece.lineFeedCnt <= 0) {
      line.pieces.push({ text: this.getTextInPiece(node.piece), length: node.piece.length, meta: node.piece.meta })
      node = node.successor()
    }

    if (line.pieces.length === 0) {
      line.pieces.push({ text: '', length: 0, meta: null })
    }

    return line
  }

  /**
   * Get All Lines
   */
  getLines(): Line[] {
    const lines: Line[] = []

    this.forEachLine(line => {
      lines.push(line)
    })

    return lines
  }

  /**
   * Get Specific Line Meta
   */
  getLineMeta(lineNumber: number): IPieceMeta | null {
    const { node } = this.findByLineNumber(lineNumber)
    if (node.piece.lineFeedCnt === 1) {
      return node.piece.meta
    }
    return null
  }

  /**
   * Get All the pieces of this tree
   */
  getPieces(): Piece[] {
    const pieces: Piece[] = []
    this.forEachPiece(piece => {
      pieces.push(piece)
    })

    return pieces
  }

  /**
   * Get Specific Range of Pieces
   */
  getPiecesInRange(from: number, to: number): Piece[] {
    from++
    to++
    if (to > from && from >= 0) {
      to = to - from
      const pieces: Piece[] = []
      let { node, reminder } = this.findByOffset(from)

      if (reminder === node.piece.length) {
        node = node.successor()
      }
      // In The Piece
      else if (reminder + to <= node.piece.length) {
        const { bufferIndex, start, meta } = node.piece
        const s = start + reminder
        const len = to

        pieces.push({ text: this.getTextInBuffer(bufferIndex, s, len), length: len, meta })

        to = 0
      } else if (reminder + to > node.piece.length) {
        const { bufferIndex, start, length, meta } = node.piece
        const s = start + reminder
        const len = length - reminder
        pieces.push({ text: this.getTextInBuffer(bufferIndex, s, len), length: len, meta })
        node = node.successor()
        to -= len
      }

      while (node !== SENTINEL && to > 0) {
        const { start, bufferIndex, length, meta } = node.piece
        if (to < node.piece.length) {
          pieces.push({ text: this.getTextInBuffer(bufferIndex, start, to), length: to, meta })
        } else {
          pieces.push({ text: this.getTextInPiece(node.piece), length, meta })
        }

        to -= length
        node = node.successor()
      }

      return pieces
    } else {
      return []
    }
  }

  // ---- Fetch Operation End ---- //

  /**
   * Get Actual Text in piece
   *
   * @param piece
   */
  protected getTextInPiece(piece: NodePiece) {
    const { bufferIndex, start, length } = piece
    return this.getTextInBuffer(bufferIndex, start, length)
  }

  /**
   * Get Actual Text in TextBuffer
   *
   * @param bufferIndex
   * @param start
   * @param length
   */
  protected getTextInBuffer(bufferIndex: number, start: number, length: number) {
    if (bufferIndex < 0) return ''
    const buffer = this.buffers[bufferIndex]
    const value = buffer.buffer.substring(start, start + length)
    return value
  }

  /**
   * Create New Piece
   * @param type
   * @param meta
   */
  protected createPiece(text: string, meta: IPieceMeta | null, lineFeedCnt: number): NodePiece {
    if (text) {
      const start = this.buffers[0].length
      const length = text.length
      const piece = new NodePiece(0, start, length, lineFeedCnt, meta ? cloneDeep(meta) : meta)

      this.buffers[0].buffer += text

      return piece
    } else {
      const piece = new NodePiece(-1, 0, 1, 0, meta ? cloneDeep(meta) : meta)
      return piece
    }
  }

  /**
   * Split One Node into two nodes
   * @param node
   * @param reminder
   */
  protected splitNode(node: PieceTreeNode, reminder: number) {
    const { bufferIndex, start, meta } = node.piece
    const leftStr = this.buffers[bufferIndex].buffer.substring(start, start + reminder)
    const leftLineFeedsCnt = computeLineFeedCnt(leftStr)

    const leftPiece = new NodePiece(bufferIndex, start, reminder, leftLineFeedsCnt, meta ? cloneDeep(meta) : meta)

    node.piece.start += reminder
    node.piece.length -= reminder
    node.piece.lineFeedCnt -= leftLineFeedsCnt

    const leftNode = this.insertFixedLeft(node, leftPiece)
    return [leftNode, node]
  }

  /**
   * Recompute how much line feeds in passed piece
   * @param piece
   */
  protected recomputeLineFeedsCntInPiece(piece: NodePiece) {
    const { bufferIndex, start, length } = piece
    if (bufferIndex < 0 || bufferIndex > this.buffers.length - 1) return 0

    const str = this.buffers[bufferIndex].buffer.substring(start, start + length)
    const cnt = computeLineFeedCnt(str)
    return cnt
  }
}

// ---------- Utils ------------ //

/**
 * 计算字符串中的换行符数量
 * @param str
 */
export function computeLineFeedCnt(str: string) {
  const matches = str.match(/\n/gm)
  if (matches) {
    return matches.length
  }
  return 0
}
