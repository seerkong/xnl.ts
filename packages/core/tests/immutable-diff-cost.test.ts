import {expect,it} from 'vitest';
import {parseXnl,diffNodes,dryRunMutations,type DataElementNode} from '../src/index';
const node=(s:string)=>parseXnl(s).nodes[0] as DataElementNode;
const profile={verifyValueBefore:true,literalAttributeRules:[{tags:['ComponentEmbed'],attributes:['input']}]} as const;
it('diff of a shared unaffected subtree stays isolated and produces original sequential preconditions',()=>{
 const before=node('<Document #doc [<P #a {text="a"}><P #b {text="b"}>]>');
 const child=before.body![0] as DataElementNode;
 const after={...before,body:[{...child,attributes:{...child.attributes,text:'changed'}},before.body![1]!]};
 const snapshot=structuredClone(before);
 const edits=diffNodes(before,after,[],profile);
 expect(dryRunMutations(before,edits,profile)).toMatchObject({status:'applied',value:after});
 expect(before).toEqual(snapshot);
 const multiple=node('<Document #doc [<P #a {text="next"}><P #c {text="c"}>]>');
 expect(dryRunMutations(before,diffNodes(before,multiple,[],profile),profile)).toMatchObject({status:'applied',value:multiple});
 expect(before).toEqual(snapshot);
});
it('a late strict rejection returns a fresh unchanged snapshot after an earlier operation applied',()=>{
 const before=node('<Document #doc [<P #a {text="a"}>]>');
 const after=node('<Document #doc [<P #a {text="b"}>]>');
 const first=diffNodes(before,after,[],profile);
 const result=dryRunMutations(before,[...first,{...first[0]!,valueBefore:'forged',valueAfter:'c'}],profile);
 expect(result.status).toBe('rejected');
 expect(result.value).toEqual(before);
 expect(result.value).not.toBe(before);
});

it.each([
 ['#a:kind', 'TextElement'],
 ['#a:id:name', 'other'],
 ['#doc:body:length', 0],
 ['#a:id:namespace:0', 'other'],
])('scalar updates at structural path %s retain full identity checks', (path,valueAfter)=>{
 const before=node('<Document #doc [<P #a {text="a"}><P #b {text="b"}>]>');
 const result=dryRunMutations(before,[{type:'OBJECT_UPDATE',path,valueAfter}],profile);
 // A tag/type change that preserves the same identity is allowed; changing a
 // Word or removing children through length must never be treated as text.
 if(path.endsWith(':kind')) expect(result.status).toBe('applied');
 else expect(result.status).toBe('rejected');
 expect(before).toEqual(node('<Document #doc [<P #a {text="a"}><P #b {text="b"}>]>'));
});

it('metadata scalar changes retain literal selector rebinding and its identity rejection',()=>{
 const before=node('<Document #doc [<Entry #entry mode="other" {payload=<Inner #inside>}>]>');
 const result=dryRunMutations(before,[{type:'OBJECT_UPDATE',path:"#entry:metadata::'mode'",valueBefore:'other',valueAfter:'literal'}],
   {verifyValueBefore:true,literalValuePaths:["<mode='literal'>:attributes::'payload'"]});
 expect(result.status).toBe('rejected');
 expect(result.diagnostics[0]?.code).toBe('IDENTITY_MUTATION_FORBIDDEN');
 expect(result.value).toEqual(before);
});
