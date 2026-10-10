'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseIrishRailStationXml}=require('../dist');
const parse=s=>parseIrishRailStationXml(s,'Ballina','2026-10-08T09:00:00Z');
const train='<objStationData><Traincode>A123</Traincode><Stationfullname>Ballina</Stationfullname><Lastlocation>Foxford &amp; Ballina</Lastlocation></objStationData>';
const root=content=>`<ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/">${content}</ArrayOfObjStationData>`;
const good=root(train);
const rejected=(name,body)=>test(name,()=>assert.throws(()=>parse(body),/invalid_rail_xml_(?:response|entity)/));

test('A04: matching case-sensitive root QName and valid board continue to parse',()=>{
 const board=parse(good);
 assert.equal(board.services.length,1);
 assert.equal(board.services[0].trainCode,'A123');
 assert.equal(board.services[0].lastLocation,'Foxford & Ballina');
});
rejected('A04: root closing QName case mismatch',good.replace('</ArrayOfObjStationData>','</arrayofobjstationdata>'));
rejected('A04: root closing QName prefix mismatch',good.replace('</ArrayOfObjStationData>','</z:ArrayOfObjStationData>'));
rejected('A04: record closing QName case mismatch',good.replace('</objStationData>','</OBJStationData>'));
rejected('A04: leaf closing QName case mismatch',good.replace('</Traincode>','</traincode>'));
rejected('A04: prefix mismatch even if local root names match',
 '<p:ArrayOfObjStationData xmlns:p="urn:test" xmlns:q="urn:test">'+train+'</q:ArrayOfObjStationData>');
rejected('A04: undeclared QName prefix is not accepted',
 '<p:ArrayOfObjStationData>'+train+'</p:ArrayOfObjStationData>');
rejected('A04: cannot read an XML record from a nested wrapper',root('<wrapper>'+train+'</wrapper>'));

test('A04: consistently-prefixed and declared QNames are valid',()=>{
 const xml='<?xml version="1.0" encoding="utf-8"?>'+
 '<r:ArrayOfObjStationData xmlns:r="urn:rail" xmlns:f="urn:fields">'+
 '<r:objStationData><f:Traincode>A777</f:Traincode><f:Stationfullname>Ballina</f:Stationfullname></r:objStationData>'+ 
 '</r:ArrayOfObjStationData>';
 assert.equal(parse(xml).services[0].trainCode,'A777');
});
rejected('A05: unquoted element attribute',good.replace('<objStationData>','<objStationData x=abc>'));
rejected('A05: duplicate attribute on a record',good.replace('<objStationData>','<objStationData x="1" x="2">'));
rejected('A05: duplicate namespace declaration on root',good.replace('xmlns="http://api.irishrail.ie/realtime/"','xmlns="one" xmlns="two"'));
rejected('A05: duplicate pseudo-attribute in XML declaration',
 '<?xml version="1.0" version="1.1"?>'+good);
rejected('A05: missing = in attribute',good.replace('<objStationData>','<objStationData flag>'));
rejected('A05: adjacent attributes without whitespace',good.replace('<objStationData>','<objStationData a="1"b="2">'));
rejected('A05: raw entity in attribute',good.replace('<objStationData>','<objStationData x="A&B">'));
rejected('A05: invalid attribute in empty root', '<ArrayOfObjStationData x=invalid/>');
rejected('A05: raw < in quoted attribute',good.replace('<objStationData>','<objStationData x="bad<value">'));

test('A05: quoted attributes may contain > and both quotation styles',()=>{
 const xml='<ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/" x="a>b">'+
 '<objStationData data=\'a>b\'><Traincode>A123</Traincode><Stationfullname>Ballina</Stationfullname></objStationData>'+ 
 '</ArrayOfObjStationData>';
 assert.equal(parse(xml).services[0].trainCode,'A123');
});
test('A04/A05: whitespace, valid comments, empty leaves and no service response',()=>{
 assert.equal(parse('<?xml version="1.0"?>\n<!-- safe -->'+
 '<ArrayOfObjStationData xmlns="urn:rail" />').services.length,0);
 assert.equal(parse(root('<!-- fake '+train+' -->'+
 '<objStationData><Traincode>A123</Traincode><Stationfullname>Ballina</Stationfullname><Expdepart /></objStationData>'))
 .services[0].expectedDeparture,null);
});
rejected('A05: duplicate field is not silently read as the first value',
 root('<objStationData><Traincode>A123</Traincode><Traincode>B123</Traincode><Stationfullname>Ballina</Stationfullname></objStationData>'));
rejected('A04: a second root outside first is invalid',good+good);
rejected('A04: DTD and CDATA remain forbidden','<!DOCTYPE x>'+good);
rejected('A04: malformed trailing-hyphen XML comment is rejected',
 '<!--invalid--->'+good);

// Additional independent review: malformed XML the first strict parser accepted.
rejected('A04: whitespace immediately after closing slash is invalid',
 good.replace('</Traincode>', '</ Traincode>'));
rejected('A04: closing slash followed by newline is invalid',
 good.replace('</objStationData>', '</\nobjStationData>'));
rejected('A05: XML forbids NUL inside text',
 good.replace('Ballina</Stationfullname>', 'Ball\u0000ina</Stationfullname>'));
rejected('A05: XML forbids control characters inside attributes',
 good.replace('<objStationData>', '<objStationData x="A\u0001B">'));
rejected('A05: XML forbids U+FFFE anywhere',
 good.replace('Ballina</Stationfullname>', 'Ball\uFFFEina</Stationfullname>'));
rejected('A05: XML forbids unpaired surrogate in text',
 good.replace('Ballina</Stationfullname>', 'Ball\uD800ina</Stationfullname>'));
rejected('A05: non-XML whitespace cannot be an attribute separator',
 good.replace('<objStationData>', '<objStationData\u00A0x="1">'));
rejected('A04: non-XML whitespace cannot trail closing QName',
 good.replace('</Traincode>', '</Traincode\u00A0>'));
