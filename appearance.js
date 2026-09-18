// Shared by the interactive view and USDZ export; the source material stays intact.
export function applyMaterialAppearance(material,base,{preset='auto',glassOpacity=.18,view='glass',arMode=false,selected=false}={}){
 material.copy(base);
 const solid=(!arMode&&view==='solid')||(view!=='original'&&preset==='solid');
 const explicitGlass=view!=='original'&&['glass','frosted'].includes(preset);
 const automaticGlass=preset==='auto'&&base.transmission>0;
 const glass=explicitGlass||((arMode||view!=='original')&&automaticGlass)||(arMode&&base.transmission>0&&preset==='original');
 if(solid){
  if('transmission'in material)material.transmission=0;
  material.transparent=false;material.opacity=1;material.depthWrite=true;
  material.map=null;material.color?.set(0xbad0d6);
  if('roughness'in material)material.roughness=.6;
  if('metalness'in material)material.metalness=.05;
 }else if(glass){
  const frosted=preset==='frosted'||(preset==='auto'&&base.roughness>=.25);
  if('transmission'in material)material.transmission=0;
  material.transparent=true;material.depthWrite=false;
  material.opacity=Math.min(.9,glassOpacity*(frosted?1.8:1));
  material.color?.set(0xcde8ed);
  if('roughness'in material)material.roughness=frosted?.38:.12;
  if('metalness'in material)material.metalness=.03;
 }
 if(selected&&!arMode){
  if(material.emissive){material.emissive.set(0x1a7160);material.emissiveIntensity=.3;}
  else material.color?.set(0x7be6cc);
  if(solid)material.color?.set(0x7be6cc);
 }
 material.needsUpdate=true;
 return material;
}
