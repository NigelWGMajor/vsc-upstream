"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NixUpstreamTreeWebviewProvider = void 0;
const vscode = __importStar(require("vscode"));
class NixUpstreamTreeWebviewProvider {
    constructor(_extensionUri, _context) {
        this._extensionUri = _extensionUri;
        this._context = _context;
        this.callTrees = [];
        this.checkedStates = new Map();
        this.selectedNodes = new Set();
        this.expandedNodes = new Set();
        this.lastComment = '';
        this.autoFocusNewItems = true; // Toggle for auto-focusing new items
        // Load the auto-focus state from context
        this.autoFocusNewItems = this._context.globalState.get('nixUpstreamCheck.autoFocusNewItems', true);
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media')
            ]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'ready':
                    this.sendInitialData();
                    break;
                case 'nodeClick':
                    await this.handleNodeClick(data.nodeId, data.modifiers);
                    break;
                case 'checkboxToggle':
                    await this.handleCheckboxToggle(data.nodeIds);
                    break;
                case 'toggleExpand':
                    await this.handleToggleExpand(data.nodeId);
                    break;
                case 'expandAll':
                    await this.handleExpandAll(data.selectedNodes || []);
                    break;
                case 'navigate':
                    await this.navigateToLocation(data.file, data.line, data.character);
                    break;
                case 'reorder':
                    await this.handleReorder(data.nodeIds || [data.nodeId], data.direction);
                    break;
                case 'selectAll':
                    await this.handleSelectAll();
                    break;
                case 'selectRange':
                    await this.handleSelectRange(data.nodeIds);
                    break;
                case 'removeSelected':
                    await this.removeSelectedNodes();
                    break;
                case 'indent':
                    await this.handleIndent(data.nodeIds || []);
                    break;
                case 'outdent':
                    await this.handleOutdent(data.nodeIds || []);
                    break;
                case 'contextMenu':
                    await this.handleContextMenu(data.nodeId, data.node);
                    break;
            }
        });
        // Handle visibility changes
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.refresh();
            }
        });
        // Initial render - will be sent once webview sends 'ready' message
    }
    async handleNodeClick(nodeId, modifiers) {
        // Update selection based on modifiers
        if (modifiers.ctrl) {
            // Toggle selection
            if (this.selectedNodes.has(nodeId)) {
                this.selectedNodes.delete(nodeId);
            }
            else {
                this.selectedNodes.add(nodeId);
            }
        }
        else if (modifiers.shift) {
            // Range selection - implement later
            this.selectedNodes.add(nodeId);
        }
        else {
            // Single selection
            this.selectedNodes.clear();
            this.selectedNodes.add(nodeId);
        }
        this.updateSelection();
    }
    async handleCheckboxToggle(nodeIds) {
        // Toggle checkbox for all selected nodes
        if (nodeIds.length === 0)
            return;
        // Determine new state based on first node
        const firstNodeKey = nodeIds[0];
        const currentState = this.checkedStates.get(firstNodeKey) ?? true;
        const newState = !currentState;
        // Apply to all selected nodes
        nodeIds.forEach(nodeId => {
            this.checkedStates.set(nodeId, newState);
        });
        // Send only checkbox state update, not full refresh
        // This preserves the webview's expanded state
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateCheckboxes',
                checkedStates: Object.fromEntries(this.checkedStates)
            });
        }
    }
    async handleToggleExpand(nodeId) {
        // Toggle expand/collapse state - backend is source of truth
        if (this.expandedNodes.has(nodeId)) {
            this.expandedNodes.delete(nodeId);
        }
        else {
            this.expandedNodes.add(nodeId);
        }
        this.refresh();
    }
    async handleExpandAll(selectedNodeIds) {
        // Recursively find all nodes and add to expandedNodes
        const addAllNodes = (node) => {
            const nodeKey = this.getNodeKey(node);
            const hasChildren = (node.children && node.children.length > 0) ||
                (node.referenceLocations && node.referenceLocations.length > 0);
            if (hasChildren) {
                this.expandedNodes.add(nodeKey);
            }
            if (node.referenceLocations) {
                node.referenceLocations.forEach((ref) => addAllNodes(ref));
            }
            if (node.children) {
                node.children.forEach((child) => addAllNodes(child));
            }
        };
        // If nodes are selected, expand only those nodes and their descendants
        if (selectedNodeIds.length > 0) {
            const findAndExpandNode = (node) => {
                const nodeKey = this.getNodeKey(node);
                if (selectedNodeIds.includes(nodeKey)) {
                    addAllNodes(node);
                    return true;
                }
                // Recursively check children
                if (node.referenceLocations) {
                    node.referenceLocations.forEach((ref) => findAndExpandNode(ref));
                }
                if (node.children) {
                    node.children.forEach((child) => findAndExpandNode(child));
                }
                return false;
            };
            this.callTrees.forEach(tree => findAndExpandNode(tree));
        }
        else {
            // No selection - expand all nodes
            this.callTrees.forEach(tree => addAllNodes(tree));
        }
        this.refresh();
    }
    async navigateToLocation(file, line, character) {
        const uri = vscode.Uri.file(file);
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        const position = new vscode.Position(line, character);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
    }
    async handleReorder(nodeIds, direction) {
        if (nodeIds.length === 0)
            return;
        // Reorder means swapping with adjacent siblings in the same array
        // Comments immediately before nodes should move with them
        const nodeIdSet = new Set(nodeIds);
        let reordered = false;
        const reorderInArray = (nodes) => {
            // Find which nodes in this array need to be moved, including their preceding comments
            const toMove = [];
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                // Only process non-comment nodes as group anchors
                // Comments will be included as part of the group with the node below them
                if (!node.isComment && nodeIdSet.has(this.getNodeKey(node))) {
                    // Found a non-comment node to move - walk backwards to include ALL consecutive comments
                    let startIndex = i;
                    while (startIndex > 0 && nodes[startIndex - 1].isComment) {
                        startIndex--;
                    }
                    toMove.push({ startIndex, endIndex: i });
                }
                else if (node.isComment && nodeIdSet.has(this.getNodeKey(node))) {
                    // Comment is explicitly selected - check if it should move independently
                    // Only add it if it's not already part of a group (i.e., the next node isn't selected)
                    const nextIndex = i + 1;
                    const nextIsSelected = nextIndex < nodes.length &&
                        !nodes[nextIndex].isComment &&
                        nodeIdSet.has(this.getNodeKey(nodes[nextIndex]));
                    if (!nextIsSelected) {
                        // This comment moves independently
                        toMove.push({ startIndex: i, endIndex: i });
                    }
                }
            }
            // If we found nodes to move at this level, reorder them
            if (toMove.length > 0) {
                const result = [...nodes];
                if (direction === 'up') {
                    // Move up: process from first to last
                    for (const { startIndex, endIndex } of toMove) {
                        const groupSize = endIndex - startIndex + 1;
                        // Can only move up if there's space and the previous element isn't part of another selected group
                        if (startIndex > 0) {
                            const prevIndex = startIndex - 1;
                            // Check if previous node is part of a selected group
                            const isPrevSelected = !nodes[prevIndex].isComment && nodeIdSet.has(this.getNodeKey(nodes[prevIndex]));
                            if (!isPrevSelected) {
                                // Move the entire group (comments + node) up by swapping with previous element
                                const temp = result[prevIndex];
                                result.splice(prevIndex, 1);
                                result.splice(prevIndex + groupSize, 0, temp);
                                reordered = true;
                            }
                        }
                    }
                }
                else {
                    // Move down: process from last to first
                    for (let i = toMove.length - 1; i >= 0; i--) {
                        const { startIndex, endIndex } = toMove[i];
                        const groupSize = endIndex - startIndex + 1;
                        // Can only move down if there's space and the next element isn't part of another selected group
                        if (endIndex < result.length - 1) {
                            const nextIndex = endIndex + 1;
                            // Check if next node is part of a selected group (or is a comment that belongs to a selected node)
                            const isNextSelected = !nodes[nextIndex].isComment && nodeIdSet.has(this.getNodeKey(nodes[nextIndex]));
                            if (!isNextSelected) {
                                // Move the entire group (comments + node) down by swapping with next element
                                const temp = result[nextIndex];
                                result.splice(nextIndex, 1);
                                result.splice(startIndex, 0, temp);
                                reordered = true;
                            }
                        }
                    }
                }
                return result;
            }
            // Not found at this level, recurse into children
            const result = nodes.map(node => {
                const newNode = { ...node };
                if (node.children) {
                    newNode.children = reorderInArray(node.children);
                }
                if (node.referenceLocations) {
                    newNode.referenceLocations = reorderInArray(node.referenceLocations);
                }
                return newNode;
            });
            return result;
        };
        this.callTrees = reorderInArray(this.callTrees);
        if (reordered) {
            this.refresh();
        }
    }
    async handleIndent(nodeIds) {
        if (nodeIds.length === 0)
            return;
        // Indent means making selected nodes children of their previous sibling
        const indented = new Set();
        const indentInArray = (nodes) => {
            const result = [];
            let previousNode = null;
            for (const node of nodes) {
                const key = this.getNodeKey(node);
                if (nodeIds.includes(key) && previousNode && !indented.has(key)) {
                    // Make this node a child of the previous node
                    if (!previousNode.children) {
                        previousNode.children = [];
                    }
                    previousNode.children.push(node);
                    indented.add(key);
                    // Automatically expand the parent node so the indented child is visible
                    const parentKey = this.getNodeKey(previousNode);
                    this.expandedNodes.add(parentKey);
                    // Don't add to result - it's now a child of previousNode
                }
                else {
                    // Process children recursively
                    const newNode = { ...node };
                    if (node.children) {
                        newNode.children = indentInArray(node.children);
                    }
                    if (node.referenceLocations) {
                        newNode.referenceLocations = indentInArray(node.referenceLocations);
                    }
                    result.push(newNode);
                    previousNode = newNode;
                }
            }
            return result;
        };
        this.callTrees = indentInArray(this.callTrees);
        this.refresh();
        vscode.window.showInformationMessage(`Indented ${indented.size} node(s)`);
    }
    async handleOutdent(nodeIds) {
        if (nodeIds.length === 0)
            return;
        // Outdent means promoting selected nodes to be siblings of their parent
        const outdented = new Set();
        const outdentInArray = (nodes, parent = null) => {
            const result = [];
            for (const node of nodes) {
                const key = this.getNodeKey(node);
                const newNode = { ...node };
                // Process children first to check if any need to be outdented
                const childrenToPromote = [];
                if (node.children) {
                    const processedChildren = [];
                    for (const child of node.children) {
                        const childKey = this.getNodeKey(child);
                        if (nodeIds.includes(childKey) && !outdented.has(childKey)) {
                            // This child should be promoted to sibling
                            childrenToPromote.push(child);
                            outdented.add(childKey);
                        }
                        else {
                            processedChildren.push(child);
                        }
                    }
                    newNode.children = outdentInArray(processedChildren, node);
                }
                if (node.referenceLocations) {
                    const processedRefs = [];
                    for (const ref of node.referenceLocations) {
                        const refKey = this.getNodeKey(ref);
                        if (nodeIds.includes(refKey) && !outdented.has(refKey)) {
                            childrenToPromote.push(ref);
                            outdented.add(refKey);
                        }
                        else {
                            processedRefs.push(ref);
                        }
                    }
                    newNode.referenceLocations = outdentInArray(processedRefs, node);
                }
                result.push(newNode);
                // Add promoted children right after this node
                if (childrenToPromote.length > 0) {
                    result.push(...childrenToPromote);
                }
            }
            return result;
        };
        this.callTrees = outdentInArray(this.callTrees);
        this.refresh();
        vscode.window.showInformationMessage(`Outdented ${outdented.size} node(s)`);
    }
    async handleSelectAll() {
        // Select all visible nodes
        this.getAllVisibleNodeIds().forEach(id => this.selectedNodes.add(id));
        this.updateSelection();
    }
    async handleSelectRange(nodeIds) {
        // Clear and set new range selection
        this.selectedNodes.clear();
        nodeIds.forEach(id => this.selectedNodes.add(id));
        this.updateSelection();
    }
    async handleContextMenu(nodeId, node) {
        const items = [];
        // Add Copy to Clipboard option at the top for all node types
        items.push({ label: '$(clippy) Copy to Clipboard', description: 'Copy node text to clipboard' });
        if (node.isComment) {
            items.push({ label: '$(edit) Edit Comment', description: 'Edit this comment' }, { label: '$(trash) Delete Comment', description: 'Remove this comment' });
        }
        else {
            items.push({ label: '$(comment) Add Comment Above', description: 'Add a comment above this node' }, { label: '$(search) Search Upstream from Here', description: 'Continue search from this reference' }, { label: '$(trash) Remove from Tree', description: 'Remove this node from the tree' });
            // If multiple nodes are selected, show options for bulk operations
            if (this.selectedNodes.size > 1 && this.selectedNodes.has(nodeId)) {
                items.push({ label: `$(trash) Remove ${this.selectedNodes.size} Selected Nodes`, description: 'Remove all selected nodes from the tree' });
            }
            if (!node.isReference) {
                items.push({ label: '$(search-fuzzy) Exhaustive Search', description: 'Search with file scan fallback' });
            }
        }
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select action'
        });
        if (selected) {
            if (selected.label.includes('Copy to Clipboard')) {
                await this.handleCopyToClipboard(nodeId, node);
            }
            else if (selected.label.includes('Add Comment')) {
                // Increment numeric part of last comment for default
                const defaultComment = this.getNextComment();
                const comment = await vscode.window.showInputBox({
                    prompt: 'Enter comment text',
                    placeHolder: 'Comment...',
                    value: defaultComment
                });
                if (comment) {
                    this.lastComment = comment;
                    // If multiple nodes selected and this node is one of them, add comment to all
                    const nodesToComment = this.selectedNodes.size > 1 && this.selectedNodes.has(nodeId)
                        ? Array.from(this.selectedNodes)
                        : [nodeId];
                    let successCount = 0;
                    for (const nId of nodesToComment) {
                        if (await this.insertCommentAboveNode(nId, comment)) {
                            successCount++;
                        }
                    }
                    if (nodesToComment.length > 1) {
                        vscode.window.showInformationMessage(`Added comment to ${successCount} of ${nodesToComment.length} nodes`);
                    }
                }
            }
            else if (selected.label.includes('Edit Comment')) {
                const newText = await vscode.window.showInputBox({
                    prompt: 'Edit comment',
                    value: node.commentText || ''
                });
                if (newText !== undefined && newText.trim()) {
                    this.lastComment = newText.trim();
                    await this.editCommentNode(nodeId, newText);
                }
            }
            else if (selected.label.includes('Delete Comment')) {
                await this.deleteCommentNode(nodeId);
            }
            else if (selected.label.includes('Remove') && selected.label.includes('Selected Nodes')) {
                // Remove all selected nodes
                await this.removeSelectedNodes();
            }
            else if (selected.label.includes('Remove from Tree')) {
                await this.removeNode(nodeId);
            }
            else if (selected.label.includes('Search Upstream')) {
                if (node.file && typeof node.line === 'number') {
                    await vscode.commands.executeCommand('nixUpstreamCheck.searchUpstreamFromReference', {
                        treeData: node
                    });
                }
            }
            else if (selected.label.includes('Exhaustive Search')) {
                if (node.file && typeof node.line === 'number') {
                    await vscode.commands.executeCommand('nixUpstreamCheck.exhaustiveSearch', {
                        treeData: node
                    });
                }
            }
        }
    }
    async handleCopyToClipboard(nodeId, node) {
        // Generate the visible text for this node
        let text = '';
        if (node.isComment) {
            text = `👇 ${node.commentText || node.name || ''}`;
        }
        else if (node.isReference) {
            text = node.name || `📍 ${(node.file || '').split(/[/\\]/).pop()}:${(node.line || 0) + 1}`;
        }
        else {
            // Method or class node
            if (node.isClass) {
                text = `c ${node.name || ''}`;
            }
            else {
                const typeIndicator = this.getTypeIndicator(node);
                text = `${typeIndicator} ${node.name || ''}`;
                if (node.httpAttribute) {
                    text += ` [${node.httpAttribute}]`;
                }
            }
        }
        // Copy to clipboard
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage(`Copied to clipboard: ${text}`);
    }
    getTypeIndicator(node) {
        // Check file name for patterns
        const fileName = (node.file || '').toLowerCase();
        let typeChar = '';
        // Check for test first (as test files might also contain 'controller', 'service', etc.)
        if (fileName.includes('test')) {
            typeChar = '𝐓';
        }
        else if (fileName.includes('orchestrator')) {
            typeChar = '𝐎';
        }
        else if (fileName.includes('controller')) {
            typeChar = '𝐂';
        }
        else if (fileName.includes('service')) {
            typeChar = '𝐒';
        }
        else if (fileName.includes('repository')) {
            typeChar = '𝐑';
        }
        else {
            // Default to M for methods if no specific pattern matched
            typeChar = '𝐌';
        }
        // If the node is an interface method (no body), prepend 𝐈
        if (node.isInterface) {
            // Combine: 𝐈 + type character (e.g., 𝐈𝐎 for interface in orchestrator)
            return '𝐈' + typeChar;
        }
        return typeChar;
    }
    updateSelection() {
        this._view?.webview.postMessage({
            type: 'updateSelection',
            selectedIds: Array.from(this.selectedNodes)
        });
    }
    getAllVisibleNodeIds() {
        const ids = [];
        const collectIds = (tree) => {
            if (!tree)
                return;
            const nodeKey = this.getNodeKey(tree);
            ids.push(nodeKey);
            if (tree.children) {
                tree.children.forEach((child) => collectIds(child));
            }
            if (tree.referenceLocations) {
                tree.referenceLocations.forEach((ref) => {
                    ids.push(this.getNodeKey(ref));
                });
            }
        };
        this.callTrees.forEach(tree => collectIds(tree));
        return ids;
    }
    setCallTree(tree) {
        this.callTrees = [tree];
        // Ensure default expanded state for root
        if (!this.expandedNodes) {
            this.expandedNodes = new Set();
        }
        // Auto-expand all nodes in the tree
        const expandTree = (node) => {
            const nodeKey = this.getNodeKey(node);
            const hasChildren = (node.children && node.children.length > 0) ||
                (node.referenceLocations && node.referenceLocations.length > 0);
            if (hasChildren) {
                this.expandedNodes.add(nodeKey);
            }
            if (node.children) {
                node.children.forEach((child) => expandTree(child));
            }
            if (node.referenceLocations) {
                node.referenceLocations.forEach((ref) => expandTree(ref));
            }
        };
        expandTree(tree);
        this.refresh();
    }
    addAsChildOfNode(nodeId, newChild) {
        // Recursively find the node and add the new item as its child
        const findAndAddChild = (nodes) => {
            for (const node of nodes) {
                const key = this.getNodeKey(node);
                if (key === nodeId) {
                    // Found the target node - add new item as child
                    if (!node.children) {
                        node.children = [];
                    }
                    // Check for duplicates in children
                    const newKey = this.getNodeKey(newChild);
                    const isDuplicate = node.children.some((child) => this.getNodeKey(child) === newKey);
                    if (!isDuplicate) {
                        node.children.push(newChild);
                        return true;
                    }
                    return false;
                }
                // Recursively check children
                if (node.children && findAndAddChild(node.children)) {
                    return true;
                }
                if (node.referenceLocations && findAndAddChild(node.referenceLocations)) {
                    return true;
                }
            }
            return false;
        };
        return findAndAddChild(this.callTrees);
    }
    addCallTree(tree, skipRefresh = false) {
        // If there's a selected node, add as child of that node
        if (this.selectedNodes.size > 0) {
            const selectedNodeId = Array.from(this.selectedNodes)[0]; // Get first selected node
            const added = this.addAsChildOfNode(selectedNodeId, tree);
            if (added) {
                // Expand the parent node
                this.expandedNodes.add(selectedNodeId);
                // Select the newly added node only if autoFocusNewItems is enabled
                if (this.autoFocusNewItems) {
                    this.selectedNodes.clear();
                    const newNodeKey = this.getNodeKey(tree);
                    this.selectedNodes.add(newNodeKey);
                }
                if (!skipRefresh) {
                    this.refresh();
                    this.updateSelection();
                }
                return true;
            }
            // If adding as child failed, fall through to add at root level
        }
        // No selection or adding as child failed - add at root level
        const newKey = this.getNodeKey(tree);
        const isDuplicate = this.callTrees.some(existingTree => {
            return this.getNodeKey(existingTree) === newKey;
        });
        if (isDuplicate) {
            return false;
        }
        this.callTrees.push(tree);
        // Auto-expand all nodes in the newly added tree
        const expandTree = (node) => {
            const nodeKey = this.getNodeKey(node);
            const hasChildren = (node.children && node.children.length > 0) ||
                (node.referenceLocations && node.referenceLocations.length > 0);
            if (hasChildren) {
                this.expandedNodes.add(nodeKey);
            }
            if (node.children) {
                node.children.forEach((child) => expandTree(child));
            }
            if (node.referenceLocations) {
                node.referenceLocations.forEach((ref) => expandTree(ref));
            }
        };
        expandTree(tree);
        // Select the newly added node only if autoFocusNewItems is enabled
        if (this.autoFocusNewItems) {
            this.selectedNodes.clear();
            this.selectedNodes.add(newKey);
        }
        if (!skipRefresh) {
            this.refresh();
            this.updateSelection();
        }
        return true;
    }
    clearTree() {
        this.callTrees = [];
        this.checkedStates.clear();
        this.selectedNodes.clear();
        this.refresh();
    }
    toggleAutoFocus() {
        this.autoFocusNewItems = !this.autoFocusNewItems;
        // Save the state to context
        this._context.globalState.update('nixUpstreamCheck.autoFocusNewItems', this.autoFocusNewItems);
        return this.autoFocusNewItems;
    }
    getAutoFocusState() {
        return this.autoFocusNewItems;
    }
    expandAll() {
        // Expand all nodes - backend is source of truth
        this.handleExpandAll([]);
    }
    getCallTrees() {
        return this.callTrees;
    }
    getExpandedNodes() {
        return this.expandedNodes;
    }
    restoreExpandedNodes(expandedNodeIds) {
        // Replace expanded nodes entirely when importing
        this.expandedNodes = new Set(expandedNodeIds);
        this.refresh();
    }
    replaceLastTree(tree) {
        if (this.callTrees.length > 0) {
            this.callTrees[this.callTrees.length - 1] = tree;
            // Auto-expand all nodes in the replaced tree
            const expandTree = (node) => {
                const nodeKey = this.getNodeKey(node);
                const hasChildren = (node.children && node.children.length > 0) ||
                    (node.referenceLocations && node.referenceLocations.length > 0);
                if (hasChildren) {
                    this.expandedNodes.add(nodeKey);
                }
                if (node.children) {
                    node.children.forEach((child) => expandTree(child));
                }
                if (node.referenceLocations) {
                    node.referenceLocations.forEach((ref) => expandTree(ref));
                }
            };
            expandTree(tree);
            this.refresh();
        }
    }
    getRootNodes() {
        return this.callTrees;
    }
    getChildren(node) {
        if (!node || !node.treeData) {
            return Promise.resolve(this.callTrees);
        }
        const children = [];
        const treeData = node.treeData;
        if (treeData.referenceLocations) {
            children.push(...treeData.referenceLocations);
        }
        if (treeData.children) {
            children.push(...treeData.children);
        }
        return Promise.resolve(children);
    }
    pruneUncheckedItems() {
        let prunedCount = 0;
        const pruneNode = (node) => {
            // Always keep comments regardless of checkbox state
            if (node.isComment) {
                return [node];
            }
            const nodeKey = this.getNodeKey(node);
            const isChecked = this.checkedStates.get(nodeKey) !== false;
            // If this node is unchecked, promote its checked children (and all comments)
            if (!isChecked) {
                prunedCount++;
                const promoted = [];
                // Collect checked children, their descendants, and all comments
                if (node.children) {
                    for (const child of node.children) {
                        promoted.push(...pruneNode(child));
                    }
                }
                if (node.referenceLocations) {
                    for (const ref of node.referenceLocations) {
                        promoted.push(...pruneNode(ref));
                    }
                }
                // Clean up state for this removed node (children are being promoted)
                this.checkedStates.delete(nodeKey);
                this.selectedNodes.delete(nodeKey);
                this.expandedNodes.delete(nodeKey);
                return promoted; // Return children to be promoted to parent level
            }
            // Node is checked, keep it but prune its children
            const keptChildren = [];
            if (node.children) {
                for (const child of node.children) {
                    keptChildren.push(...pruneNode(child));
                }
            }
            if (node.referenceLocations) {
                for (const ref of node.referenceLocations) {
                    keptChildren.push(...pruneNode(ref));
                }
            }
            // Split promoted children back into children and referenceLocations
            // Comments always go into children
            node.children = keptChildren.filter(n => !n.isReference || n.isComment);
            node.referenceLocations = keptChildren.filter(n => n.isReference && !n.isComment);
            return [node]; // Return array with this node
        };
        const newTrees = [];
        for (const tree of this.callTrees) {
            newTrees.push(...pruneNode(tree));
        }
        this.callTrees = newTrees;
        // Clean up expanded nodes that no longer exist in the tree
        this.cleanupExpandedNodes();
        this.refresh();
        return prunedCount;
    }
    getNextComment() {
        if (!this.lastComment) {
            return '';
        }
        // Find numeric parts and increment the last one
        const numMatch = this.lastComment.match(/\d+/g);
        if (numMatch && numMatch.length > 0) {
            const lastNum = numMatch[numMatch.length - 1];
            const incremented = (parseInt(lastNum) + 1).toString().padStart(lastNum.length, '0');
            // Replace the last occurrence of the number
            const lastIndex = this.lastComment.lastIndexOf(lastNum);
            return this.lastComment.substring(0, lastIndex) + incremented + this.lastComment.substring(lastIndex + lastNum.length);
        }
        return this.lastComment;
    }
    async insertCommentAboveNode(nodeId, commentText) {
        const commentNode = {
            isComment: true,
            commentText: commentText,
            name: commentText
        };
        // Find and insert comment above the specified node
        const insertComment = (nodes, parent = null) => {
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                const key = this.getNodeKey(node);
                if (key === nodeId) {
                    // Insert comment before this node
                    nodes.splice(i, 0, commentNode);
                    return true;
                }
                // Check children
                if (node.children && insertComment(node.children, node)) {
                    return true;
                }
                if (node.referenceLocations && insertComment(node.referenceLocations, node)) {
                    return true;
                }
            }
            return false;
        };
        const success = insertComment(this.callTrees);
        if (success) {
            this.refresh();
            // Don't show message here - caller will handle it
        }
        return success;
    }
    async editCommentNode(nodeId, newText) {
        // Find and edit comment
        const editComment = (nodes) => {
            for (const node of nodes) {
                const key = this.getNodeKey(node);
                if (key === nodeId && node.isComment) {
                    node.commentText = newText;
                    node.name = newText;
                    return true;
                }
                // Recursively check children
                if (node.children && editComment(node.children)) {
                    return true;
                }
                if (node.referenceLocations && editComment(node.referenceLocations)) {
                    return true;
                }
            }
            return false;
        };
        const success = editComment(this.callTrees);
        if (success) {
            this.refresh();
            vscode.window.showInformationMessage('Comment updated');
        }
        else {
            vscode.window.showErrorMessage('Failed to update comment');
        }
    }
    async deleteCommentNode(nodeId) {
        // Find and delete comment
        const deleteComment = (nodes) => {
            return nodes.filter(node => {
                const key = this.getNodeKey(node);
                if (key === nodeId && node.isComment) {
                    return false; // Remove this comment
                }
                // Recursively check children
                if (node.children) {
                    node.children = deleteComment(node.children);
                }
                if (node.referenceLocations) {
                    node.referenceLocations = deleteComment(node.referenceLocations);
                }
                return true; // Keep this node
            });
        };
        this.callTrees = deleteComment(this.callTrees);
        this.checkedStates.delete(nodeId);
        this.selectedNodes.delete(nodeId);
        this.refresh();
        vscode.window.showInformationMessage('Comment deleted');
    }
    async removeNode(nodeId) {
        // Find and remove node from tree, promoting its children to siblings
        // Comments are preserved - they stay at their current level
        let nodeFound = false;
        let removedNode = null;
        const removeFromTree = (nodes) => {
            const result = [];
            for (const node of nodes) {
                const key = this.getNodeKey(node);
                if (key === nodeId && !node.isComment) {
                    // Found the node to remove!
                    nodeFound = true;
                    removedNode = node;
                    // Promote all children to current level (make them siblings)
                    // First, collect all children (both regular children and reference locations)
                    const promotedNodes = [];
                    if (node.children) {
                        promotedNodes.push(...node.children);
                    }
                    if (node.referenceLocations) {
                        promotedNodes.push(...node.referenceLocations);
                    }
                    // Add promoted nodes to result (they become siblings)
                    result.push(...promotedNodes);
                    // Don't add this node itself - it's been removed
                }
                else {
                    // Keep this node, but recursively process its children
                    // Create a new node object to avoid mutation issues
                    const newNode = { ...node };
                    if (node.children && node.children.length > 0) {
                        newNode.children = removeFromTree(node.children);
                    }
                    if (node.referenceLocations && node.referenceLocations.length > 0) {
                        newNode.referenceLocations = removeFromTree(node.referenceLocations);
                    }
                    result.push(newNode);
                }
            }
            return result;
        };
        this.callTrees = removeFromTree(this.callTrees);
        if (nodeFound && removedNode) {
            // Recursively clean up all state for the removed node (but not its promoted children)
            this.checkedStates.delete(nodeId);
            this.selectedNodes.delete(nodeId);
            this.expandedNodes.delete(nodeId);
            // Clean up expanded nodes that no longer exist in the tree
            this.cleanupExpandedNodes();
            this.refresh();
            vscode.window.showInformationMessage('Node removed from tree');
        }
        else {
            vscode.window.showWarningMessage(`Could not find node with ID: ${nodeId}`);
        }
    }
    async removeSelectedNodes() {
        if (this.selectedNodes.size === 0) {
            return;
        }
        const count = this.selectedNodes.size;
        const nodeIdsToRemove = new Set(this.selectedNodes);
        // Find and remove all selected nodes from tree, moving their children to siblings
        // unless the children are also selected for removal
        const removeFromTree = (nodes) => {
            const result = [];
            for (const node of nodes) {
                const key = this.getNodeKey(node);
                if (nodeIdsToRemove.has(key) && !node.isComment) {
                    // Only remove non-comment nodes
                    // Collect children to promote (recursively process them first to handle nested removals)
                    const promotedChildren = [];
                    if (node.children && node.children.length > 0) {
                        promotedChildren.push(...removeFromTree(node.children));
                    }
                    if (node.referenceLocations && node.referenceLocations.length > 0) {
                        promotedChildren.push(...removeFromTree(node.referenceLocations));
                    }
                    // Clean up state for this removed node only (children are promoted)
                    this.checkedStates.delete(key);
                    this.selectedNodes.delete(key);
                    this.expandedNodes.delete(key);
                    // Promote children to current level (make them siblings)
                    result.push(...promotedChildren);
                    // Don't add this node itself - it's been removed
                }
                else {
                    // Keep this node, but recursively process its children
                    // Create a new node object to avoid mutation issues
                    const newNode = { ...node };
                    if (node.children && node.children.length > 0) {
                        newNode.children = removeFromTree(node.children);
                    }
                    if (node.referenceLocations && node.referenceLocations.length > 0) {
                        newNode.referenceLocations = removeFromTree(node.referenceLocations);
                    }
                    result.push(newNode);
                }
            }
            return result;
        };
        this.callTrees = removeFromTree(this.callTrees);
        // Clean up expanded nodes that no longer exist in the tree
        this.cleanupExpandedNodes();
        this.refresh();
        vscode.window.showInformationMessage(`${count} nodes removed from tree`);
    }
    insertCommentAbove(node, commentText) {
        const commentTreeData = {
            isComment: true,
            commentText: commentText,
            name: commentText
        };
        // For webview, we need to implement insertion logic
        // This is a simplified version - you may need to adapt based on your tree structure
        return false; // Placeholder
    }
    editComment(node, newText) {
        if (node.treeData && node.treeData.isComment) {
            node.treeData.commentText = newText;
            node.treeData.name = newText;
            this.refresh();
        }
    }
    deleteComment(node) {
        // Placeholder - implement deletion logic
        return false;
    }
    serializeTreeWithCheckboxes(tree) {
        const serialize = (node) => {
            const nodeKey = this.getNodeKey(node);
            const result = { ...node };
            result.checked = this.checkedStates.get(nodeKey) !== false;
            if (node.children) {
                result.children = node.children.map((child) => serialize(child));
            }
            if (node.referenceLocations) {
                result.referenceLocations = node.referenceLocations.map((ref) => serialize(ref));
            }
            return result;
        };
        return serialize(tree);
    }
    restoreCheckboxStates(tree) {
        const restore = (node) => {
            const nodeKey = this.getNodeKey(node);
            if (node.checked !== undefined) {
                this.checkedStates.set(nodeKey, node.checked);
            }
            if (node.children) {
                node.children.forEach((child) => restore(child));
            }
            if (node.referenceLocations) {
                node.referenceLocations.forEach((ref) => restore(ref));
            }
        };
        restore(tree);
    }
    treeToMarkdown(tree, indent, treeIndex) {
        let markdown = '';
        const prefix = '  '.repeat(indent);
        const checkbox = this.checkedStates.get(this.getNodeKey(tree)) !== false ? '[x]' : '[ ]';
        if (tree.isComment) {
            markdown += `${prefix}- 👇 ${tree.commentText}\n`;
        }
        else if (tree.isReference) {
            markdown += `${prefix}- ${checkbox} 📍 ${tree.name}\n`;
        }
        else {
            markdown += `${prefix}- ${checkbox} ${tree.name}\n`;
        }
        if (tree.referenceLocations) {
            tree.referenceLocations.forEach((ref) => {
                markdown += this.treeToMarkdown(ref, indent + 1, treeIndex);
            });
        }
        if (tree.children) {
            tree.children.forEach((child) => {
                markdown += this.treeToMarkdown(child, indent + 1, treeIndex);
            });
        }
        return markdown;
    }
    findExistingTree(file, line) {
        return this.callTrees.find(tree => tree.file === file && tree.line === line) || null;
    }
    findNodeByFileAndLine(file, line) {
        const search = (node) => {
            if (node.file === file && node.line === line) {
                return node;
            }
            if (node.children) {
                for (const child of node.children) {
                    const found = search(child);
                    if (found)
                        return found;
                }
            }
            if (node.referenceLocations) {
                for (const ref of node.referenceLocations) {
                    const found = search(ref);
                    if (found)
                        return found;
                }
            }
            return null;
        };
        for (const tree of this.callTrees) {
            const found = search(tree);
            if (found)
                return found;
        }
        return null;
    }
    removeCallTree(treeData) {
        const index = this.callTrees.findIndex(tree => tree === treeData);
        if (index >= 0) {
            this.callTrees.splice(index, 1);
            this.refresh();
            return true;
        }
        return false;
    }
    getNodeKey(node) {
        if (node.isComment) {
            return `comment_${node.commentText}_${node.file || ''}_${node.line || 0}`;
        }
        if (node.isReference) {
            const char = node.character !== undefined ? node.character : 0;
            return `ref_${node.file}_${node.line}_${char}_${node.referenceType || ''}`;
        }
        return `${node.namespace || ''}.${node.name}_${node.file || ''}_${node.line || 0}`;
    }
    cleanupExpandedNodes() {
        // Build a set of all valid node keys that exist in the current tree
        const validNodeKeys = new Set();
        const collectNodeKeys = (node) => {
            if (!node)
                return;
            const nodeKey = this.getNodeKey(node);
            validNodeKeys.add(nodeKey);
            if (node.children) {
                node.children.forEach((child) => collectNodeKeys(child));
            }
            if (node.referenceLocations) {
                node.referenceLocations.forEach((ref) => collectNodeKeys(ref));
            }
        };
        this.callTrees.forEach(tree => collectNodeKeys(tree));
        // Remove expanded states for nodes that no longer exist
        const expandedToRemove = [];
        this.expandedNodes.forEach(nodeKey => {
            if (!validNodeKeys.has(nodeKey)) {
                expandedToRemove.push(nodeKey);
            }
        });
        expandedToRemove.forEach(nodeKey => this.expandedNodes.delete(nodeKey));
    }
    recursivelyCleanupNodeState(node) {
        // Recursively clean up checkbox and selection states for this node and all descendants
        const nodeKey = this.getNodeKey(node);
        this.checkedStates.delete(nodeKey);
        this.selectedNodes.delete(nodeKey);
        this.expandedNodes.delete(nodeKey);
        if (node.children) {
            node.children.forEach((child) => this.recursivelyCleanupNodeState(child));
        }
        if (node.referenceLocations) {
            node.referenceLocations.forEach((ref) => this.recursivelyCleanupNodeState(ref));
        }
    }
    refresh() {
        if (this._view) {
            // Always try to send data if view exists
            // The webview will handle it when ready
            this._view.webview.postMessage({
                type: 'refresh',
                trees: this.callTrees,
                checkedStates: Object.fromEntries(this.checkedStates),
                expandedNodes: Array.from(this.expandedNodes)
            }).then(() => { }, // Success - do nothing
            (err) => { } // Error - ignore, webview might not be ready yet
            );
        }
    }
    // Call this when webview becomes visible
    sendInitialData() {
        if (this._view) {
            this.refresh();
        }
    }
    _getHtmlForWebview(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'tree.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'tree.css'));
        // Use a nonce to only allow specific scripts to be run
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Upstream Tree</title>
</head>
<body>
    <div id="tree-container"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
exports.NixUpstreamTreeWebviewProvider = NixUpstreamTreeWebviewProvider;
NixUpstreamTreeWebviewProvider.viewType = 'nixUpstreamCheckTree';
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=treeWebview.js.map