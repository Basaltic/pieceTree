import { NodeColor, NodePosition } from './common'
import { SENTINEL, PieceNode, Piece, PieceType, createPieceNode } from './pieceNode'
import cloneDeep from 'lodash.clonedeep'

/**
 *
 * PieceNodeList Implemented Using A Balanced Binary Tree(RBTree)
 *
 */
export class PieceNodeList {
  public root: PieceNode = SENTINEL

  /**
   * Actual Content Size Which is used as accordination base.
   */
  public get size(): number {
    return this.root.leftSize + this.root.rightSize + this.root.size
  }

  /**
   * How many nodes in this list
   */
  public get nodeCnt(): number {
    return this.root.leftNodeCnt + this.root.rightNodeCnt + 1
  }

  /**
   * Number of Line Feeds in the list
   */
  public get lineFeedCnt(): number {
    return this.root.leftLineFeedCnt + this.root.rightLineFeedCnt + this.root.lineFeedCnt
  }

  /**
   * First Node Of the list
   */
  public get firstNode(): PieceNode {
    return this.get(1)
  }

  /**
   * Last Node in the list
   */
  public get lastNode(): PieceNode {
    return this.get(this.nodeCnt)
  }

  constructor() {}

  // --------------

  /**
   * Get node in specific index
   *
   * @param index
   */
  public get(index: number): PieceNode {
    let node = this.root

    if (index > 0 && index <= this.nodeCnt) {
      while (node !== SENTINEL) {
        if (node.leftNodeCnt > index) {
          node = node.left
        } else if (node.leftNodeCnt + 1 === index) {
          // -- Found
          break
        } else {
          index -= node.leftLineFeedCnt
          index -= 1
          node = node.right
        }
      }
    }

    return node
  }

  /**
   * Find Node Postion In Specific Offset
   *
   * @param offset
   */
  public find(offset: number): NodePosition {
    let node = this.root
    let reminder = 0
    let startOffset = 0
    let startLineFeedCnt = 0

    if (offset <= 0) return { node: this.root.lefest(), reminder: 0, startOffset: startOffset, startLineFeedCnt }
    if (offset >= this.size) {
      const lastNode = this.root.rightest()
      return {
        node: lastNode,
        reminder: lastNode.piece.length,
        startOffset: this.size - lastNode.piece.length,
        startLineFeedCnt: this.lineFeedCnt - lastNode.piece.lineFeedCnt,
      }
    }

    while (node !== SENTINEL) {
      if (node.leftSize > offset) {
        node = node.left
      } else if (node.leftSize + node.size > offset) {
        reminder = offset - node.leftSize
        startOffset += node.leftSize
        startLineFeedCnt += node.leftLineFeedCnt
        break
      } else {
        if (node.right === SENTINEL) break

        offset -= node.leftSize + node.size
        startOffset += node.leftSize + node.size
        startLineFeedCnt += node.leftLineFeedCnt + node.lineFeedCnt

        node = node.right
      }
    }

    return { node, reminder, startOffset: startOffset, startLineFeedCnt }
  }

  /**
   * Split a node into to two new node
   * 1. split into two text piece node
   * 2. split into two structural piece node(paragraph)
   *
   * @param pieceNode Node To Split
   * @param offset Where To Split
   */
  public splitNode(pieceNode: PieceNode, offset: number, structural: boolean = false) {
    const { bufferIndex, start, meta, pieceType } = pieceNode.piece

    const leftPiece: Piece = { bufferIndex, start, length: offset, lineFeedCnt: 0, meta: cloneDeep(meta), pieceType: pieceType }

    pieceNode.piece.start += offset
    pieceNode.piece.length -= offset
    pieceNode.piece.lineFeedCnt -= 0

    const leftNode = new PieceNode(leftPiece)

    this.insertBefore(pieceNode, leftNode)

    // TODO: Split Above Node into two parts
    // Structural Node which contains Text Node Directly can be splitted
    if (structural) {
      const p = leftNode.above
      if (p.isNotNil && p.piece.pieceType === PieceType.STRUCTURAL) {
        const piece = cloneDeep(p.piece)
        const node = createPieceNode(piece)
        p.above.insertAfter(p, node)

        // Removed Child in left node will move to right node
        let removedNode = leftNode.successor()
        while (removedNode.isNotNil) {
          p.removeChild(removedNode)
          node.appendChild(removedNode)
        }

        return [p, node]
      }
    }

    return [leftNode, pieceNode]
  }

  /**
   * Insert a new node to the leftest of the tree
   * @param newNode
   */
  public prepend(newNode: PieceNode) {
    const referenceNode = this.firstNode
    this.insertBefore(newNode, referenceNode)
  }

  /**
   * Insert a new node after the last node
   *
   * @param newNode
   */
  public append(newNode: PieceNode) {
    const referenceNode = this.lastNode
    this.insertAfter(newNode, referenceNode)
  }

  /**
   * Insert newNode as Node predecessor
   *
   * @param {PieceNode} newNode
   * @param {PieceNode} referenceNode
   */
  public insertBefore(newNode: PieceNode, referenceNode: PieceNode): PieceNode {
    if (referenceNode === SENTINEL) {
      this.root = newNode
    } else {
      referenceNode.before(newNode)
    }

    newNode.updateMetaUpward()
    this.insertFixup(newNode)

    return newNode
  }

  /**
   * Insert new Node as Node successor
   *
   * @param newNode
   * @param referenceNode
   */
  public insertAfter(newNode: PieceNode, referenceNode: PieceNode): PieceNode {
    if (referenceNode === SENTINEL) {
      this.root = newNode
    } else {
      referenceNode.after(newNode)
    }
    newNode.updateMetaUpward()
    this.insertFixup(newNode)

    return newNode
  }

  /**
   * Delete Node
   * @param node
   */
  public deleteNode(z: PieceNode): PieceNode {
    let y = z
    let yOriginalColor = y.color

    let x = y

    // 1.
    if (z.left.isNil) {
      x = z.right
      this.transplant(z, z.right)

      x.parent.updateMetaUpward()
    } else if (z.right.isNil) {
      x = z.left
      this.transplant(z, z.left)

      x.parent.updateMetaUpward()
    }
    // 3. 左树、右树都存在。用该节点的后继节点移植
    else {
      y = z.right.lefest()
      yOriginalColor = y.color
      x = y.right

      if (y.parent === z) {
        x.parent = y
      } else {
        this.transplant(y, y.right)
        y.right = z.right
        y.right.parent = y
      }

      this.transplant(z, y)
      y.left = z.left
      y.left.parent = y
      y.color = z.color

      x.parent.updateMetaUpward()
      y.updateMetaUpward()
    }

    if (yOriginalColor === NodeColor.BLACK) {
      this.deleteNodeFixup(x)
    }

    z.detach()
    return z
  }

  /**
   * Fixup the tree after node deletion
   * @param x node which is used to replace deleted node
   */
  protected deleteNodeFixup(x: PieceNode) {
    while (!x.isRoot && x.isBlack) {
      if (x.isLeft) {
        let w = x.parent.right
        if (w.isRed) {
          w.toBlack()
          x.parent.toRed()
          this.leftRotate(x.parent)
          w = x.parent.right
        }

        if (w.left.isBlack && w.right.isBlack) {
          w.toRed()
          x = x.parent
        } else if (w.right.isBlack) {
          w.left.toBlack()
          w.toRed()
          this.rightRotate(w)
          w = x.parent.right
        } else {
          w.color = x.parent.color
          x.parent.toBlack()
          w.right.toBlack()
          this.leftRotate(x.parent)
          x = this.root
        }
      } else {
        let w = x.parent.left
        if (w.isRed) {
          w.toBlack()
          x.parent.toRed()
          this.rightRotate(x.parent)
          w = x.parent.left
        }

        if (w.right.isBlack && w.left.isBlack) {
          w.toRed()
          x = x.parent
        } else if (w.left.isBlack) {
          w.right.toBlack()
          w.toRed()
          this.leftRotate(w)
          w = x.parent.left
        } else {
          w.color = x.parent.color
          x.parent.toBlack()
          w.left.toBlack()
          this.rightRotate(x.parent)
          x = this.root
        }
      }
    }

    x.toBlack()
  }

  /**
   * Fix up The Tree
   * @param node
   */
  protected insertFixup(node: PieceNode) {
    // 0. 传入节点的父节点是红色节点，就不断循环
    while (node.parent.isRed) {
      // 1. 插入的节点的父节点是 左节点
      if (node.parent.isLeft) {
        const uncle = node.parent.parent.right
        if (uncle.isRed) {
          // 1.1 叔叔节点亦是红色节点，重新染色
          node.parent.toBlack()
          uncle.toBlack()
          node.parent.parent.toRed()
          node = node.parent.parent
        } else if (node.isRight) {
          // 1.2
          node = node.parent
          this.leftRotate(node)
        } else {
          // 1.3
          node.parent.toBlack()
          node.parent.parent.toRed()
          this.rightRotate(node.parent.parent)
        }
      } else {
        const uncle = node.parent.parent.left

        if (uncle.isRed) {
          node.parent.toBlack()
          uncle.toBlack()
          node.parent.parent.toRed()
          node = node.parent.parent
        } else if (node.isLeft) {
          node = node.parent
          this.rightRotate(node)
        } else {
          node.parent.toBlack()
          node.parent.parent.toRed()

          this.leftRotate(node.parent.parent)
        }
      }
    }

    this.root.toBlack()
  }

  /**
   * Tree Left Rotate
   *
   *      g                   g
   *      |                   |
   *      x                   y
   *    /   \   ======>     /   \
   *  a       y           x       c
   *        /   \       /   \
   *      b       c   a       b
   */
  protected leftRotate(x: PieceNode) {
    // 1. Link x's right to y's left
    const y = x.right
    const b = y.left

    x.right = b

    // 2. Link Parent to x
    if (b.isNotNil) {
      b.parent = x
    }

    // 3. Link y's parent to x's parent
    y.parent = x.parent

    // 4. No Parent means x is root. Set root to y
    if (x.isRoot) {
      this.root = y
    } else if (x.isLeft) {
      x.parent.left = y
    } else {
      x.parent.right = y
    }

    y.left = x
    x.parent = y

    x.updateMeta()
    y.updateMeta()
  }

  /**
   * Tree Right Rotate
   *
   *          g                         g
   *          |                         |
   *          y                         x
   *        /   \                     /   \
   *      x       c   =====>        a       y
   *    /   \                             /   \
   *  a       b                         b       c
   *
   */
  protected rightRotate(y: PieceNode) {
    const x = y.left
    const b = x.right

    y.left = b

    if (b.isNotNil) {
      b.parent = y
    }

    x.parent = y.parent

    if (y.isRoot) {
      this.root = x
    } else if (y.isLeft) {
      y.parent.left = x
    } else {
      y.parent.right = x
    }

    x.right = y
    y.parent = x

    y.updateMeta()
    x.updateMeta()
  }

  /**
   * Tansplant one subtree to another
   *
   * @param x
   * @param y
   */
  protected transplant(x: PieceNode, y: PieceNode) {
    if (x.isRoot) {
      this.root = y
    } else if (x.isLeft) {
      x.parent.left = y
    } else {
      x.parent.right = y
    }
    y.parent = x.parent
  }
}
