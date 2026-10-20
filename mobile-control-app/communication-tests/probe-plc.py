"""Read-only EtherNet/IP identity and two explicit controller-route probes."""
import json
import socket
import struct
from pathlib import Path

HOST = "192.168.41.129"

def exact(sock, size):
    out = b""
    while len(out) < size:
        part = sock.recv(size-len(out))
        if not part:
            raise ConnectionError("connection closed")
        out += part
    return out

def exchange(sock, command, payload=b"", session=0):
    sock.sendall(struct.pack("<HHII8sI",command,len(payload),session,0,b"PCRTEST1",0)+payload)
    h=struct.unpack("<HHII8sI",exact(sock,24))
    body=exact(sock,h[1])
    if h[3]:
        raise RuntimeError(f"encapsulation status {h[3]:08x}")
    return h[2],body

def symbolic(tag):
    data=tag.encode("ascii")
    path=bytes((0x91,len(data)))+data+b"\0"*(len(data)%2)
    return bytes((len(path)//2,))+path

def cip(sock, session, request):
    payload=struct.pack("<IHHHHHH",0,0,2,0,0,0xb2,len(request))+request
    _,response=exchange(sock,0x6f,payload,session)
    count=struct.unpack_from("<H",response,6)[0]
    offset=8
    for _ in range(count):
        kind,length=struct.unpack_from("<HH",response,offset);offset+=4
        if kind==0xb2:
            return response[offset:offset+length]
        offset+=length
    raise ValueError("no unconnected CIP reply")

def main():
    result={"host":HOST,"writes_sent":0,"reads":[]}
    with socket.create_connection((HOST,44818),timeout=5) as sock:
        sock.settimeout(5)
        session,_=exchange(sock,0x65,b"\1\0\0\0")
        result["session_registered"]=bool(session)
        try:
            _,identity=exchange(sock,0x63,session=session)
            if len(identity)>37:
                item=identity[6:]
                vendor,device_type,product=struct.unpack_from("<HHH",item,18)
                size=item[32]
                result["identity"]={"vendor":vendor,"device_type":device_type,"product":product,"name":item[33:33+size].decode("ascii",errors="replace")}
        except Exception as error:
            result["identity_error"]=str(error)
        listing=cip(sock,session,bytes.fromhex("55 03 20 6b 25 00 00 00 02 00 01 00 02 00"))
        result["symbol_listing_status"]=listing[2] if len(listing)>2 else None
        symbols=[]
        if len(listing)>=4 and listing[2] in (0,6):
            offset=4+listing[3]*2
            while offset+8<=len(listing):
                instance,size=struct.unpack_from("<IH",listing,offset)
                if offset+8+size>len(listing):
                    break
                name=listing[offset+6:offset+6+size].decode("ascii",errors="replace")
                kind=struct.unpack_from("<H",listing,offset+6+size)[0]
                symbols.append({"instance":instance,"name":name,"type":kind})
                offset+=8+size
        result["visible_symbols_first_page"]=symbols
        request=b"\x4c"+symbolic("HMI_Manual_1P")+b"\1\0"
        for slot in (None,0,2):
            query=request
            if slot is not None:
                query=bytes.fromhex("52 02 20 06 24 01 0a 0e")+struct.pack("<H",len(request))+request+b"\0"*(len(request)%2)+bytes((1,0,1,slot))
            response=cip(sock,session,query)
            result["reads"].append({"route":"direct" if slot is None else f"1/{slot}","cip_reply":response.hex(" "),"general_status":response[2] if len(response)>2 else None})
    target=Path(__file__).with_name("probe-result.json")
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf8")
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()
