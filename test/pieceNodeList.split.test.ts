import { Paragraph } from '../src/pieceNode.paragraph'
import { Text } from '../src/pieceNode.text'

it('Text Piece Node Split', () => {
  const paragraph = new Paragraph({})

  const text = new Text(0, 0, 10, {})

  paragraph.appendChild(text)

  const result = text.split(2)

  expect(result).toBe(true)
  expect(paragraph.childNodeCnt).toBe(2)
  expect(text.piece.start).toBe(0)
  expect(text.piece.length).toBe(2)

  expect(text.successor().piece.start).toBe(2)
  expect(text.successor().piece.length).toBe(8)
})

it('PieceNodeList: splitStructuralNode (static)', () => {})
