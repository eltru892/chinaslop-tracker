#include <jni.h>
extern int setenv(const char*,const char*,int);
extern int node_start(int,char**) __asm__("_ZN4node5StartEiPPc");
JNIEXPORT jint JNICALL Java_local_chinaslop_tracker_MainActivity_startNode(JNIEnv* env,jclass cls,jstring root,jstring data,jint port,jstring key) {
  const char* rootValue=(*env)->GetStringUTFChars(env,root,0);
  const char* dataValue=(*env)->GetStringUTFChars(env,data,0);
  const char* accessKey=(*env)->GetStringUTFChars(env,key,0);
  if(!rootValue || !dataValue || !accessKey)return -1;
  char args[8192]={'n','o','d','e',0};unsigned int n=5;
  for(const char* p=rootValue;*p && n<8100;p++)args[n++]=*p;
  const char suffix[]="/server.mjs";for(unsigned int i=0;i<sizeof(suffix);i++)args[n++]=suffix[i];
  char portValue[12];int length=0;unsigned int number=(unsigned int)port;
  do{portValue[length++]=(char)('0'+number%10);number/=10;}while(number);
  for(int i=0;i<length/2;i++){char c=portValue[i];portValue[i]=portValue[length-i-1];portValue[length-i-1]=c;}portValue[length]=0;
  setenv("TRACKER_ACCESS_KEY",accessKey,1);setenv("TRACKER_DATA_DIR",dataValue,1);setenv("PORT",portValue,1);
  (*env)->ReleaseStringUTFChars(env,root,rootValue);(*env)->ReleaseStringUTFChars(env,data,dataValue);(*env)->ReleaseStringUTFChars(env,key,accessKey);
  char* argv[]={args,args+5};return node_start(2,argv);
}
